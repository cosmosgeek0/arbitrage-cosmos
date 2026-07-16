import { types as nodeUtilTypes } from 'node:util';
import { createHash } from 'node:crypto';

import { PRIVATE_DATA_BOUNDS, privateAccountRealmReference } from './bounds.js';

/**
 * Pure, documentary USD-M private-stream lifecycle reduction.
 *
 * Inputs are sanitized observations made elsewhere. This module never accepts
 * a listen-key value, credential, signature, URL, request body, socket, clock,
 * timer or scheduler callback. In particular, the generation numbers below
 * are local opaque counters; they are not token-derived identities.
 */

export const USDM_PRIVATE_LIFECYCLE_SCHEMA = 'BINANCE_USDM_PRIVATE_LIFECYCLE_V1' as const;
export const USDM_PRIVATE_LIFECYCLE_VERSION = 1 as const;
export const USDM_PRIVATE_MATRIX_SHA256 =
  '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac' as const;

export const USDM_LISTEN_KEY_LIFETIME_MS = 60 * 60 * 1_000;
export const USDM_PRIVATE_CONNECTION_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const USDM_PRIVATE_MAXIMUM_FUTURE_SKEW_MS = 2_000;
export const USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS = 256;
export const USDM_OWNER_REST_MAXIMUM_FRESHNESS_MS = PRIVATE_DATA_BOUNDS.maximumFactAgeMs;
export const USDM_PRIVATE_DEFAULT_ACCOUNT_REALM_ID = 'account-realm-synthetic-a' as const;

export const USDM_PRIVATE_DOCUMENTARY_CONTRACTS = Object.freeze({
  leasePost: 'USDM_LISTEN_KEY_POST',
  leasePut: 'USDM_LISTEN_KEY_PUT',
  leaseDelete: 'USDM_LISTEN_KEY_DELETE',
  rawRoute: 'USDM_WS_PRIVATE_USER_DATA',
  queryRawRoute: 'USDM_WS_PRIVATE_USER_DATA_QUERY_RAW',
  combinedRoute: 'USDM_WS_PRIVATE_USER_DATA_COMBINED',
} as const);

export const USDM_PRIVATE_EVENT_KINDS = Object.freeze([
  'ACCOUNT_CONFIG_UPDATE',
  'ACCOUNT_UPDATE',
  'ALGO_UPDATE',
  'CONDITIONAL_ORDER_TRIGGER_REJECT',
  'GRID_UPDATE',
  'MARGIN_CALL',
  'ORDER_TRADE_UPDATE',
  'STRATEGY_UPDATE',
  'TRADE_LITE',
  'listenKeyExpired',
] as const);

export const USDM_PRIVATE_EVENT_SEMANTIC_CATEGORIES = Object.freeze([
  'ACCOUNT',
  'ORDER',
  'FILL',
  'OTHER',
] as const);

export const USDM_ORDER_TRADE_EXECUTION_TYPES = Object.freeze([
  'NEW',
  'CANCELED',
  'CALCULATED',
  'EXPIRED',
  'TRADE',
  'AMENDMENT',
] as const);

export const USDM_PRIVATE_ROUTE_CLASSES = Object.freeze([
  'RAW',
  'QUERY_RAW',
  'COMBINED',
] as const);

export const USDM_PRIVATE_LIFECYCLE_PHASES = Object.freeze([
  'UNCONFIGURED',
  'LEASE_ACTIVE',
  'CONNECTED_UNAUTHENTICATED',
  'ROUTE_AUTHENTICATED',
  'SUBSCRIBED',
  'DISCONNECTED_LEASE_ACTIVE',
  'LEASE_CLOSED',
  'LEASE_NOT_FOUND',
  'LEASE_EXPIRED',
  'CONNECTION_EXPIRED',
] as const);

export type UsdmPrivateEventKind = (typeof USDM_PRIVATE_EVENT_KINDS)[number];
export type UsdmPrivateEventSemanticCategory =
  (typeof USDM_PRIVATE_EVENT_SEMANTIC_CATEGORIES)[number];
export type UsdmOrderTradeExecutionType =
  (typeof USDM_ORDER_TRADE_EXECUTION_TYPES)[number];
export type UsdmPrivateRouteClass = (typeof USDM_PRIVATE_ROUTE_CLASSES)[number];
export type UsdmPrivateLifecyclePhase = (typeof USDM_PRIVATE_LIFECYCLE_PHASES)[number];
export type UsdmPrivateRouteContractId =
  | typeof USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute
  | typeof USDM_PRIVATE_DOCUMENTARY_CONTRACTS.queryRawRoute
  | typeof USDM_PRIVATE_DOCUMENTARY_CONTRACTS.combinedRoute;
export type UsdmListenKeyContractId =
  | typeof USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost
  | typeof USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut
  | typeof USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leaseDelete;

export type UsdmLeaseDisposition =
  | 'ABSENT'
  | 'ACTIVE'
  | 'CLOSED'
  | 'NOT_FOUND'
  | 'EXPIRED_BY_EVENT'
  | 'EXPIRED_BY_TIME';

export type UsdmRestReconciliationFreshness =
  | 'UNAVAILABLE'
  | 'FRESH'
  | 'STALE'
  | 'GENERATION_MISMATCH'
  | 'LAGGING_STREAM';

export type UsdmContinuityPosture =
  | 'UNPROVED'
  | 'RECONCILIATION_REQUIRED'
  | 'OWNER_CUT_COVERS_OBSERVED_EVENTS';
export type UsdmPrivateQualityPosture = 'CLEAN' | 'CURRENT_GENERATION_DEGRADED';

export interface UsdmPrivateEventWatermark {
  readonly eventKind: UsdmPrivateEventKind;
  readonly exchangeEventTimeMs: number;
  readonly transactionTimeMs: number | null;
}

export interface UsdmRecentEventMarker extends UsdmPrivateEventWatermark {
  readonly accountRealmId: string;
  readonly generation: number;
  readonly eventRevision: string;
  /** Sanitized opaque commitment to the normalized private payload. */
  readonly contentRevision: string;
  readonly semanticCategory: UsdmPrivateEventSemanticCategory;
  readonly orderExecutionType: UsdmOrderTradeExecutionType | null;
  readonly isFill: boolean;
  readonly receiptTimeMs: number;
}

export interface UsdmPrivateEventSemantics {
  readonly semanticCategory: UsdmPrivateEventSemanticCategory;
  readonly orderExecutionType: UsdmOrderTradeExecutionType | null;
  readonly isFill: boolean;
}

export interface UsdmOwnerRestCut {
  readonly accountRealmId: string;
  readonly generation: number;
  readonly reconciliationRevision: string;
  readonly reconciledAtMs: number;
  readonly validUntilMs: number;
  readonly throughEventRevision: string | null;
  readonly throughExchangeEventTimeMs: number;
}

export interface UsdmPrivateLifecycleState {
  readonly schema: typeof USDM_PRIVATE_LIFECYCLE_SCHEMA;
  readonly version: typeof USDM_PRIVATE_LIFECYCLE_VERSION;
  readonly matrixSha256: typeof USDM_PRIVATE_MATRIX_SHA256;
  readonly product: 'USD_M_PERPETUAL';
  readonly environment: 'PRODUCTION';
  readonly realm: 'PRIVATE_USER_DATA';
  readonly accountRealmId: string;
  /** Canonical commitment over every normalized state field except itself. */
  readonly stateContentRevision: string;
  readonly revision: number;
  /** Local lease generation only. No listen-key value is accepted or retained. */
  readonly leaseGeneration: number;
  readonly leaseDisposition: UsdmLeaseDisposition;
  readonly leaseObservedBy: UsdmListenKeyContractId | null;
  readonly leaseObservedAtMs: number | null;
  readonly leaseValidUntilMs: number | null;
  /** A deterministic deadline marker, never a scheduling instruction. */
  readonly renewBeforeMs: number | null;
  /** Local connection generation only. */
  readonly generation: number;
  readonly phase: UsdmPrivateLifecyclePhase;
  readonly routeClass: UsdmPrivateRouteClass | null;
  readonly routeContractId: UsdmPrivateRouteContractId | null;
  readonly connected: boolean;
  readonly authenticated: boolean;
  readonly subscribed: boolean;
  readonly connectedAtMs: number | null;
  readonly connectionValidUntilMs: number | null;
  /** Injected planned reconnect marker, never a timer or reconnect command. */
  readonly reconnectBeforeMs: number | null;
  readonly reconnectDue: boolean;
  readonly disconnectedAtMs: number | null;
  readonly lastEvaluatedAtMs: number;
  readonly lastPrivateEventKind: UsdmPrivateEventKind | null;
  readonly lastAccountEvent: Readonly<UsdmRecentEventMarker> | null;
  readonly lastOrderEvent: Readonly<UsdmRecentEventMarker> | null;
  readonly lastFillEvent: Readonly<UsdmRecentEventMarker> | null;
  readonly lastExchangeEventTimeMs: number | null;
  readonly lastTransactionTimeMs: number | null;
  readonly lastReceiptTimeMs: number | null;
  readonly eventWatermarks: readonly Readonly<UsdmPrivateEventWatermark>[];
  readonly recentEventMarkers: readonly Readonly<UsdmRecentEventMarker>[];
  readonly recentEventRevisions: readonly string[];
  readonly dedupeCoverageTruncated: boolean;
  readonly observedEventCount: number;
  readonly duplicateEventCount: number;
  readonly outOfOrderEventCount: number;
  readonly conflictingEventCount: number;
  readonly malformedEventCount: number;
  readonly staleGenerationEventCount: number;
  readonly qualityPosture: UsdmPrivateQualityPosture;
  readonly lastQualityLossAtMs: number | null;
  readonly listenKeyNotFoundCount: number;
  readonly reconnectCount: number;
  readonly closeCount: number;
  readonly lastContinuityBreakAtMs: number | null;
  readonly continuityPosture: UsdmContinuityPosture;
  readonly ownerRestCut: Readonly<UsdmOwnerRestCut> | null;
  readonly restReconciliationFreshness: UsdmRestReconciliationFreshness;
  readonly sequenceCompleteness: 'UNKNOWN_NO_GLOBAL_SEQUENCE';
  readonly sendEligible: false;
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly accountReadAuthorized: false;
  readonly mutationAuthorized: false;
  readonly reconciliationAuthority: 'NONE';
  readonly capitalAuthority: 'NONE';
  readonly riskAuthority: 'NONE';
}

type UsdmPrivateLifecycleAccountScope = {
  readonly accountRealmId: string;
};

export type UsdmPrivateLifecycleAction = UsdmPrivateLifecycleAccountScope & (
  | {
      readonly kind: 'LEASE_POST_OBSERVED';
      readonly contractId: typeof USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost;
      readonly leaseGeneration: number;
      readonly observedAtMs: number;
    }
  | {
      readonly kind: 'LEASE_PUT_OBSERVED';
      readonly contractId: typeof USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut;
      readonly leaseGeneration: number;
      readonly observedAtMs: number;
    }
  | {
      readonly kind: 'LEASE_DELETE_OBSERVED';
      readonly contractId: typeof USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leaseDelete;
      readonly leaseGeneration: number;
      readonly observedAtMs: number;
    }
  | {
      readonly kind: 'LEASE_NOT_FOUND_OBSERVED';
      readonly contractId: typeof USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut;
      readonly leaseGeneration: number;
      readonly errorCode: -1125;
      readonly observedAtMs: number;
    }
  | {
      readonly kind: 'CONNECTION_OPENED';
      readonly contractId: UsdmPrivateRouteContractId;
      readonly generation: number;
      readonly observedAtMs: number;
      readonly reconnectBeforeMs: number;
    }
  | {
      readonly kind: 'ROUTE_AUTHENTICATED';
      readonly contractId: UsdmPrivateRouteContractId;
      readonly generation: number;
      readonly observedAtMs: number;
    }
  | {
      readonly kind: 'STREAM_SUBSCRIBED';
      readonly contractId: UsdmPrivateRouteContractId;
      readonly generation: number;
      readonly observedAtMs: number;
    }
  | {
      readonly kind: 'PRIVATE_EVENT_OBSERVED';
      readonly generation: number;
      readonly eventKind: string;
      readonly semanticCategory: UsdmPrivateEventSemanticCategory;
      readonly orderExecutionType: UsdmOrderTradeExecutionType | null;
      readonly isFill: boolean;
      readonly exchangeEventTimeMs: number;
      readonly transactionTimeMs: number | null;
      readonly receiptTimeMs: number;
      readonly eventRevision: string;
      readonly contentRevision: string;
    }
  | {
      readonly kind: 'MALFORMED_EVENT_OBSERVED';
      readonly generation: number;
      readonly receiptTimeMs: number;
    }
  | {
      readonly kind: 'CONNECTION_CLOSED';
      readonly generation: number;
      readonly observedAtMs: number;
      readonly reason: 'TRANSPORT_CLOSED' | 'PLANNED_RECONNECT' | 'REMOTE_CLOSED';
    }
  | {
      readonly kind: 'OWNER_REST_RECONCILIATION_OBSERVED';
      readonly generation: number;
      readonly reconciliationRevision: string;
      readonly reconciledAtMs: number;
      readonly validUntilMs: number;
      readonly throughEventRevision: string | null;
      readonly throughExchangeEventTimeMs: number;
    }
  | {
      readonly kind: 'EVALUATED';
      readonly evaluatedAtMs: number;
    });

export type UsdmPrivateLifecycleRejectReason =
  | 'STATE_INVALID'
  | 'ACTION_INVALID'
  | 'ACCOUNT_REALM_MISMATCH'
  | 'TIME_REGRESSION'
  | 'TIME_OVERFLOW'
  | 'LEASE_GENERATION_MISMATCH'
  | 'CONNECTION_GENERATION_MISMATCH'
  | 'LEASE_REQUIRED'
  | 'LEASE_EXPIRED'
  | 'CONNECTION_REQUIRED'
  | 'CONNECTION_ALREADY_OPEN'
  | 'CONNECTION_EXPIRED'
  | 'ROUTE_CONTRACT_MISMATCH'
  | 'AUTHENTICATION_REQUIRED'
  | 'SUBSCRIPTION_REQUIRED'
  | 'EVENT_TIME_IN_FUTURE'
  | 'RECONNECT_PLAN_INVALID'
  | 'REST_CUT_INVALID'
  | 'REST_REVISION_CONFLICT'
  | 'COUNTER_LIMIT_REACHED';

export type UsdmPrivateLifecycleDecision =
  | {
      readonly applied: true;
      readonly state: Readonly<UsdmPrivateLifecycleState>;
    }
  | {
      readonly applied: false;
      readonly state: Readonly<UsdmPrivateLifecycleState> | null;
      readonly reasonCode: UsdmPrivateLifecycleRejectReason;
    };

type DataRecord = Readonly<Record<string, unknown>>;

const MAXIMUM_COUNTER = 1_000_000;
const EVENT_REVISION_PATTERN = /^usdm_event_[0-9a-f]{32}$/;
const CONTENT_REVISION_PATTERN = /^usdm_content_[0-9a-f]{32}$/;
const RECONCILIATION_REVISION_PATTERN = /^usdm_rest_[0-9a-f]{32}$/;
const STATE_CONTENT_REVISION_PATTERN = /^usdm_state_[0-9a-f]{64}$/;

const STATE_FIELDS = Object.freeze([
  'schema', 'version', 'matrixSha256', 'product', 'environment', 'realm',
  'accountRealmId', 'stateContentRevision', 'revision',
  'leaseGeneration', 'leaseDisposition', 'leaseObservedBy', 'leaseObservedAtMs',
  'leaseValidUntilMs', 'renewBeforeMs', 'generation', 'phase', 'routeClass',
  'routeContractId', 'connected', 'authenticated', 'subscribed', 'connectedAtMs',
  'connectionValidUntilMs', 'reconnectBeforeMs', 'reconnectDue', 'disconnectedAtMs',
  'lastEvaluatedAtMs', 'lastPrivateEventKind', 'lastAccountEvent', 'lastOrderEvent',
  'lastFillEvent', 'lastExchangeEventTimeMs',
  'lastTransactionTimeMs', 'lastReceiptTimeMs', 'eventWatermarks',
  'recentEventMarkers', 'recentEventRevisions', 'dedupeCoverageTruncated', 'observedEventCount',
  'duplicateEventCount', 'outOfOrderEventCount', 'conflictingEventCount',
  'malformedEventCount', 'staleGenerationEventCount', 'listenKeyNotFoundCount',
  'qualityPosture', 'lastQualityLossAtMs',
  'reconnectCount', 'closeCount', 'lastContinuityBreakAtMs', 'continuityPosture',
  'ownerRestCut', 'restReconciliationFreshness', 'sequenceCompleteness',
  'sendEligible', 'externalActionAuthorization', 'actionAuthority',
  'accountReadAuthorized', 'mutationAuthorized', 'reconciliationAuthority',
  'capitalAuthority', 'riskAuthority',
] as const);

const ACTION_FIELDS = Object.freeze({
  LEASE_POST_OBSERVED: ['kind', 'accountRealmId', 'contractId', 'leaseGeneration', 'observedAtMs'],
  LEASE_PUT_OBSERVED: ['kind', 'accountRealmId', 'contractId', 'leaseGeneration', 'observedAtMs'],
  LEASE_DELETE_OBSERVED: ['kind', 'accountRealmId', 'contractId', 'leaseGeneration', 'observedAtMs'],
  LEASE_NOT_FOUND_OBSERVED: [
    'kind', 'accountRealmId', 'contractId', 'leaseGeneration', 'errorCode', 'observedAtMs',
  ],
  CONNECTION_OPENED: [
    'kind', 'accountRealmId', 'contractId', 'generation', 'observedAtMs', 'reconnectBeforeMs',
  ],
  ROUTE_AUTHENTICATED: ['kind', 'accountRealmId', 'contractId', 'generation', 'observedAtMs'],
  STREAM_SUBSCRIBED: ['kind', 'accountRealmId', 'contractId', 'generation', 'observedAtMs'],
  PRIVATE_EVENT_OBSERVED: [
    'kind', 'accountRealmId', 'generation', 'eventKind', 'exchangeEventTimeMs', 'transactionTimeMs',
    'receiptTimeMs', 'eventRevision', 'contentRevision', 'semanticCategory', 'orderExecutionType', 'isFill',
  ],
  MALFORMED_EVENT_OBSERVED: ['kind', 'accountRealmId', 'generation', 'receiptTimeMs'],
  CONNECTION_CLOSED: ['kind', 'accountRealmId', 'generation', 'observedAtMs', 'reason'],
  OWNER_REST_RECONCILIATION_OBSERVED: [
    'kind', 'accountRealmId', 'generation', 'reconciliationRevision', 'reconciledAtMs', 'validUntilMs',
    'throughEventRevision', 'throughExchangeEventTimeMs',
  ],
  EVALUATED: ['kind', 'accountRealmId', 'evaluatedAtMs'],
} as const);

const WATERMARK_FIELDS = Object.freeze([
  'eventKind', 'exchangeEventTimeMs', 'transactionTimeMs',
] as const);
const EVENT_MARKER_FIELDS = Object.freeze([
  'accountRealmId', 'generation', 'eventKind', 'exchangeEventTimeMs',
  'transactionTimeMs', 'eventRevision', 'contentRevision', 'semanticCategory', 'orderExecutionType',
  'isFill', 'receiptTimeMs',
] as const);
const REST_CUT_FIELDS = Object.freeze([
  'accountRealmId', 'generation', 'reconciliationRevision', 'reconciledAtMs', 'validUntilMs',
  'throughEventRevision', 'throughExchangeEventTimeMs',
] as const);

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function usdmContentRevision(
  domain: 'usdm_event' | 'usdm_rest',
  accountRealmId: string,
  content: readonly unknown[],
): string {
  return `${domain}_${createHash('sha256')
    .update(JSON.stringify([
      'L05_USDM_PRIVATE_CONTENT_REVISION_V2', domain, accountRealmId, ...content,
    ]))
    .digest('hex')
    .slice(0, 32)}`;
}

function usdmEventRevisionFor(input: Readonly<{
  accountRealmId: string;
  generation: number;
  eventKind: UsdmPrivateEventKind;
  contentRevision: string;
  exchangeEventTimeMs: number;
  transactionTimeMs: number | null;
  semanticCategory: UsdmPrivateEventSemanticCategory;
  orderExecutionType: UsdmOrderTradeExecutionType | null;
  isFill: boolean;
  receiptTimeMs: number;
}>): string {
  return usdmContentRevision('usdm_event', input.accountRealmId, [
    input.generation,
    input.eventKind,
    input.contentRevision,
    input.exchangeEventTimeMs,
    input.transactionTimeMs,
    input.semanticCategory,
    input.orderExecutionType,
    input.isFill,
    input.receiptTimeMs,
  ]);
}

function usdmRestRevisionFor(input: Readonly<{
  accountRealmId: string;
  generation: number;
  reconciledAtMs: number;
  validUntilMs: number;
  throughEventRevision: string | null;
  throughExchangeEventTimeMs: number;
}>): string {
  return usdmContentRevision('usdm_rest', input.accountRealmId, [
    input.generation,
    input.reconciledAtMs,
    input.validUntilMs,
    input.throughEventRevision,
    input.throughExchangeEventTimeMs,
  ]);
}

/** Builds the canonical content-derived revision used by injected USD-M evidence. */
export function createUsdmRealmBoundRevision(
  domain: 'usdm_event' | 'usdm_rest',
  accountRealmId: string,
  contentValue: unknown,
): string {
  if (!isAccountRealmId(accountRealmId)) {
    throw new TypeError('USD-M revision accountRealmId must be a namespaced account realm');
  }
  if (domain === 'usdm_event') {
    const record = snapshotClosedDataRecord(contentValue, [
      'generation', 'eventKind', 'contentRevision', 'exchangeEventTimeMs', 'transactionTimeMs',
      'semanticCategory', 'orderExecutionType', 'isFill', 'receiptTimeMs',
    ]);
    if (record === null || !isCounter(record.generation) || record.generation < 1
      || !includes(USDM_PRIVATE_EVENT_KINDS, record.eventKind)
      || typeof record.contentRevision !== 'string'
      || !CONTENT_REVISION_PATTERN.test(record.contentRevision)
      || !isTime(record.exchangeEventTimeMs)
      || (record.transactionTimeMs !== null && !isTime(record.transactionTimeMs))
      || !includes(USDM_PRIVATE_EVENT_SEMANTIC_CATEGORIES, record.semanticCategory)
      || (record.orderExecutionType !== null
        && !includes(USDM_ORDER_TRADE_EXECUTION_TYPES, record.orderExecutionType))
      || typeof record.isFill !== 'boolean' || !isTime(record.receiptTimeMs)) {
      throw new TypeError('USD-M event revision content is invalid');
    }
    const semantics = mapUsdmPrivateEventSemantics(record.eventKind, record.orderExecutionType);
    if (semantics === null || semantics.semanticCategory !== record.semanticCategory
      || semantics.isFill !== record.isFill) {
      throw new TypeError('USD-M event revision semantics are invalid');
    }
    return usdmEventRevisionFor({
      accountRealmId,
      generation: record.generation,
      eventKind: record.eventKind,
      contentRevision: record.contentRevision,
      exchangeEventTimeMs: record.exchangeEventTimeMs,
      transactionTimeMs: record.transactionTimeMs as number | null,
      semanticCategory: semantics.semanticCategory,
      orderExecutionType: semantics.orderExecutionType,
      isFill: semantics.isFill,
      receiptTimeMs: record.receiptTimeMs,
    });
  }
  const record = snapshotClosedDataRecord(contentValue, [
    'generation', 'reconciledAtMs', 'validUntilMs',
    'throughEventRevision', 'throughExchangeEventTimeMs',
  ]);
  if (record === null || !isCounter(record.generation) || record.generation < 1
    || !isTime(record.reconciledAtMs) || !isTime(record.validUntilMs)
    || (record.throughEventRevision !== null
      && (typeof record.throughEventRevision !== 'string'
        || !EVENT_REVISION_PATTERN.test(record.throughEventRevision)))
    || !isTime(record.throughExchangeEventTimeMs)) {
    throw new TypeError('USD-M REST revision content is invalid');
  }
  return usdmRestRevisionFor({
    accountRealmId,
    generation: record.generation,
    reconciledAtMs: record.reconciledAtMs,
    validUntilMs: record.validUntilMs,
    throughEventRevision: record.throughEventRevision as string | null,
    throughExchangeEventTimeMs: record.throughExchangeEventTimeMs,
  });
}

/** Map sanitized official event discriminants to closed lifecycle semantics. */
export function mapUsdmPrivateEventSemantics(
  eventKind: unknown,
  orderExecutionType: unknown = null,
): Readonly<UsdmPrivateEventSemantics> | null {
  if (!includes(USDM_PRIVATE_EVENT_KINDS, eventKind)) return null;
  if (eventKind === 'ORDER_TRADE_UPDATE') {
    if (!includes(USDM_ORDER_TRADE_EXECUTION_TYPES, orderExecutionType)) return null;
    return Object.freeze({
      semanticCategory: 'ORDER' as const,
      orderExecutionType,
      isFill: orderExecutionType === 'TRADE',
    });
  }
  if (orderExecutionType !== null) return null;
  if (eventKind === 'ACCOUNT_UPDATE') {
    return Object.freeze({
      semanticCategory: 'ACCOUNT' as const,
      orderExecutionType: null,
      isFill: false,
    });
  }
  if (eventKind === 'TRADE_LITE') {
    return Object.freeze({
      semanticCategory: 'FILL' as const,
      orderExecutionType: null,
      isFill: true,
    });
  }
  return Object.freeze({
    semanticCategory: 'OTHER' as const,
    orderExecutionType: null,
    isFill: false,
  });
}

function snapshotDataRecord(value: unknown, maximumFields: number): DataRecord | null {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
      || nodeUtilTypes.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > maximumFields || keys.some((key) => typeof key !== 'string')) return null;
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const field of keys as string[]) {
      const descriptor = descriptors[field];
      if (descriptor === undefined || !descriptor.enumerable
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      snapshot[field] = descriptor.value;
    }
    return Object.freeze(snapshot);
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

function snapshotAction(value: unknown): DataRecord | null {
  const outer = snapshotDataRecord(value, 12);
  if (outer === null || typeof outer.kind !== 'string'
    || !Object.prototype.hasOwnProperty.call(ACTION_FIELDS, outer.kind)) return null;
  return snapshotClosedDataRecord(value, ACTION_FIELDS[outer.kind as keyof typeof ACTION_FIELDS]);
}

function snapshotDenseArray(value: unknown, maximum: number): readonly unknown[] | null {
  try {
    if (!Array.isArray(value) || nodeUtilTypes.isProxy(value)
      || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
      || Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const allowed = new Set<string>(['length']);
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const field = String(index);
      allowed.add(field);
      const descriptor = descriptors[field];
      if (descriptor === undefined || !descriptor.enumerable
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      output.push(descriptor.value);
    }
    if (Object.keys(descriptors).some((field) => !allowed.has(field))) return null;
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function snapshotRevisionArray(value: unknown): readonly string[] | null {
  const array = snapshotDenseArray(value, USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS);
  if (array === null || array.some((item) => typeof item !== 'string'
    || !EVENT_REVISION_PATTERN.test(item)) || new Set(array).size !== array.length) return null;
  return Object.freeze(array.map((item) => item as string));
}

function snapshotWatermarks(value: unknown): readonly Readonly<UsdmPrivateEventWatermark>[] | null {
  const array = snapshotDenseArray(value, USDM_PRIVATE_EVENT_KINDS.length);
  if (array === null) return null;
  const output: UsdmPrivateEventWatermark[] = [];
  const kinds = new Set<string>();
  for (const item of array) {
    const record = snapshotClosedDataRecord(item, WATERMARK_FIELDS);
    if (record === null || !includes(USDM_PRIVATE_EVENT_KINDS, record.eventKind)
      || !isTime(record.exchangeEventTimeMs)
      || (record.transactionTimeMs !== null && !isTime(record.transactionTimeMs))
      || kinds.has(record.eventKind)) return null;
    kinds.add(record.eventKind);
    output.push(Object.freeze({
      eventKind: record.eventKind,
      exchangeEventTimeMs: record.exchangeEventTimeMs,
      transactionTimeMs: record.transactionTimeMs as number | null,
    }));
  }
  output.sort((left, right) => left.eventKind < right.eventKind ? -1 : left.eventKind > right.eventKind ? 1 : 0);
  return Object.freeze(output);
}

function snapshotEventMarker(value: unknown): Readonly<UsdmRecentEventMarker> | null {
  const record = snapshotClosedDataRecord(value, EVENT_MARKER_FIELDS);
  if (record === null || !isAccountRealmId(record.accountRealmId)
    || !isCounter(record.generation) || record.generation < 1
    || !includes(USDM_PRIVATE_EVENT_KINDS, record.eventKind)
    || !isTime(record.exchangeEventTimeMs)
    || (record.transactionTimeMs !== null && !isTime(record.transactionTimeMs))
    || !isTime(record.receiptTimeMs)
    || typeof record.eventRevision !== 'string'
    || !EVENT_REVISION_PATTERN.test(record.eventRevision)
    || typeof record.contentRevision !== 'string'
    || !CONTENT_REVISION_PATTERN.test(record.contentRevision)
    || !includes(USDM_PRIVATE_EVENT_SEMANTIC_CATEGORIES, record.semanticCategory)
    || typeof record.isFill !== 'boolean') return null;
  const semantics = mapUsdmPrivateEventSemantics(record.eventKind, record.orderExecutionType);
  if (semantics === null || semantics.semanticCategory !== record.semanticCategory
    || semantics.isFill !== record.isFill) return null;
  const futureLimit = addLifetime(record.receiptTimeMs, USDM_PRIVATE_MAXIMUM_FUTURE_SKEW_MS);
  if (futureLimit === null || record.exchangeEventTimeMs > futureLimit
    || (record.transactionTimeMs !== null && record.transactionTimeMs > futureLimit)) return null;
  const marker = Object.freeze({
    accountRealmId: record.accountRealmId,
    generation: record.generation,
    eventKind: record.eventKind,
    exchangeEventTimeMs: record.exchangeEventTimeMs,
    transactionTimeMs: record.transactionTimeMs as number | null,
    eventRevision: record.eventRevision,
    contentRevision: record.contentRevision,
    semanticCategory: semantics.semanticCategory,
    orderExecutionType: semantics.orderExecutionType,
    isFill: semantics.isFill,
    receiptTimeMs: record.receiptTimeMs,
  });
  if (marker.eventRevision !== usdmEventRevisionFor(marker)) return null;
  return marker;
}

function snapshotEventMarkers(value: unknown): readonly Readonly<UsdmRecentEventMarker>[] | null {
  const array = snapshotDenseArray(value, USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS);
  if (array === null) return null;
  const output: UsdmRecentEventMarker[] = [];
  const revisions = new Set<string>();
  for (const item of array) {
    const marker = snapshotEventMarker(item);
    if (marker === null || revisions.has(marker.eventRevision)) return null;
    revisions.add(marker.eventRevision);
    output.push(marker);
  }
  return Object.freeze(output);
}

function snapshotRestCut(value: unknown): Readonly<UsdmOwnerRestCut> | null {
  if (value === null) return null;
  const record = snapshotClosedDataRecord(value, REST_CUT_FIELDS);
  if (record === null || !isAccountRealmId(record.accountRealmId)
    || !isCounter(record.generation)
    || typeof record.reconciliationRevision !== 'string'
    || !RECONCILIATION_REVISION_PATTERN.test(record.reconciliationRevision)
    || !isTime(record.reconciledAtMs) || !isTime(record.validUntilMs)
    || (record.throughEventRevision !== null
      && (typeof record.throughEventRevision !== 'string'
        || !EVENT_REVISION_PATTERN.test(record.throughEventRevision)))
    || !isTime(record.throughExchangeEventTimeMs)
    || record.validUntilMs < record.reconciledAtMs
    || record.validUntilMs - record.reconciledAtMs > USDM_OWNER_REST_MAXIMUM_FRESHNESS_MS
    || record.throughExchangeEventTimeMs > record.reconciledAtMs) return null;
  const cut = Object.freeze({
    accountRealmId: record.accountRealmId,
    generation: record.generation,
    reconciliationRevision: record.reconciliationRevision,
    reconciledAtMs: record.reconciledAtMs,
    validUntilMs: record.validUntilMs,
    throughEventRevision: record.throughEventRevision as string | null,
    throughExchangeEventTimeMs: record.throughExchangeEventTimeMs,
  });
  if (cut.reconciliationRevision !== usdmRestRevisionFor(cut)) return null;
  return cut;
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isAccountRealmId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return privateAccountRealmReference(value, 'USD-M lifecycle accountRealmId') === value;
  } catch {
    return false;
  }
}

function isCounter(value: unknown): value is number {
  return isTime(value) && value <= MAXIMUM_COUNTER;
}

function increment(value: number): number | null {
  return value < MAXIMUM_COUNTER ? value + 1 : null;
}

function addLifetime(startMs: number, lifetimeMs: number): number | null {
  const result = startMs + lifetimeMs;
  return Number.isSafeInteger(result) ? result : null;
}

function canonicalStateValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalStateValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .map((field) => [
      field,
      canonicalStateValue((value as Record<string, unknown>)[field]),
    ]);
}

function usdmStateContentRevisionFor(
  state: Omit<UsdmPrivateLifecycleState, 'stateContentRevision'>,
): string {
  const content = STATE_FIELDS
    .filter((field) => field !== 'stateContentRevision')
    .sort()
    .map((field) => [field, canonicalStateValue(state[field])]);
  return `usdm_state_${createHash('sha256')
    .update(JSON.stringify(['L05_USDM_PRIVATE_STATE_CONTENT_V1', content]))
    .digest('hex')}`;
}

type NormalizedUsdmPrivateEvent = Readonly<{
  marker: Readonly<UsdmRecentEventMarker> | null;
  reasonCode: 'ACTION_INVALID' | 'EVENT_TIME_IN_FUTURE' | 'TIME_OVERFLOW' | null;
}>;

function normalizeUsdmPrivateEventAction(record: DataRecord): NormalizedUsdmPrivateEvent {
  if (!isCounter(record.generation) || record.generation < 1
    || !includes(USDM_PRIVATE_EVENT_KINDS, record.eventKind)
    || !isTime(record.exchangeEventTimeMs)
    || (record.transactionTimeMs !== null && !isTime(record.transactionTimeMs))
    || !isTime(record.receiptTimeMs)
    || typeof record.eventRevision !== 'string'
    || !EVENT_REVISION_PATTERN.test(record.eventRevision)
    || typeof record.contentRevision !== 'string'
    || !CONTENT_REVISION_PATTERN.test(record.contentRevision)
    || !includes(USDM_PRIVATE_EVENT_SEMANTIC_CATEGORIES, record.semanticCategory)
    || (record.orderExecutionType !== null
      && !includes(USDM_ORDER_TRADE_EXECUTION_TYPES, record.orderExecutionType))
    || typeof record.isFill !== 'boolean'
    || !isAccountRealmId(record.accountRealmId)) {
    return Object.freeze({ marker: null, reasonCode: 'ACTION_INVALID' });
  }
  const semantics = mapUsdmPrivateEventSemantics(record.eventKind, record.orderExecutionType);
  if (semantics === null || semantics.semanticCategory !== record.semanticCategory
    || semantics.isFill !== record.isFill) {
    return Object.freeze({ marker: null, reasonCode: 'ACTION_INVALID' });
  }
  const futureLimit = addLifetime(record.receiptTimeMs, USDM_PRIVATE_MAXIMUM_FUTURE_SKEW_MS);
  if (futureLimit === null) return Object.freeze({ marker: null, reasonCode: 'TIME_OVERFLOW' });
  if (record.exchangeEventTimeMs > futureLimit
    || (record.transactionTimeMs !== null && record.transactionTimeMs > futureLimit)) {
    return Object.freeze({ marker: null, reasonCode: 'EVENT_TIME_IN_FUTURE' });
  }
  const marker = Object.freeze({
    accountRealmId: record.accountRealmId,
    generation: record.generation,
    eventKind: record.eventKind,
    contentRevision: record.contentRevision,
    exchangeEventTimeMs: record.exchangeEventTimeMs,
    transactionTimeMs: record.transactionTimeMs as number | null,
    eventRevision: record.eventRevision,
    semanticCategory: semantics.semanticCategory,
    orderExecutionType: semantics.orderExecutionType,
    isFill: semantics.isFill,
    receiptTimeMs: record.receiptTimeMs,
  });
  if (marker.eventRevision !== usdmEventRevisionFor(marker)) {
    return Object.freeze({ marker: null, reasonCode: 'ACTION_INVALID' });
  }
  return Object.freeze({ marker, reasonCode: null });
}

function routeClassFor(contractId: unknown): UsdmPrivateRouteClass | null {
  if (contractId === USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute) return 'RAW';
  if (contractId === USDM_PRIVATE_DOCUMENTARY_CONTRACTS.queryRawRoute) return 'QUERY_RAW';
  if (contractId === USDM_PRIVATE_DOCUMENTARY_CONTRACTS.combinedRoute) return 'COMBINED';
  return null;
}

function routeContractFor(routeClass: UsdmPrivateRouteClass | null): UsdmPrivateRouteContractId | null {
  if (routeClass === 'RAW') return USDM_PRIVATE_DOCUMENTARY_CONTRACTS.rawRoute;
  if (routeClass === 'QUERY_RAW') return USDM_PRIVATE_DOCUMENTARY_CONTRACTS.queryRawRoute;
  if (routeClass === 'COMBINED') return USDM_PRIVATE_DOCUMENTARY_CONTRACTS.combinedRoute;
  return null;
}

function restFreshness(
  cut: Readonly<UsdmOwnerRestCut> | null,
  generation: number,
  evaluatedAtMs: number,
  lastExchangeEventTimeMs: number | null,
  lastEventRevision: string | null,
): UsdmRestReconciliationFreshness {
  if (cut === null) return 'UNAVAILABLE';
  if (cut.generation !== generation) return 'GENERATION_MISMATCH';
  if (evaluatedAtMs > cut.validUntilMs) return 'STALE';
  if (lastExchangeEventTimeMs !== null
    && (cut.throughEventRevision !== lastEventRevision
      || cut.throughExchangeEventTimeMs !== lastExchangeEventTimeMs)) return 'LAGGING_STREAM';
  return 'FRESH';
}

function currentUsdmEventRevision(
  state: Pick<UsdmPrivateLifecycleState,
  | 'lastPrivateEventKind' | 'lastExchangeEventTimeMs' | 'lastTransactionTimeMs'
  | 'lastReceiptTimeMs' | 'recentEventMarkers'>,
): string | null {
  if (state.lastPrivateEventKind === null || state.lastExchangeEventTimeMs === null
    || state.lastReceiptTimeMs === null) return null;
  return state.recentEventMarkers.find((marker) => (
    marker.eventKind === state.lastPrivateEventKind
    && marker.exchangeEventTimeMs === state.lastExchangeEventTimeMs
    && marker.transactionTimeMs === state.lastTransactionTimeMs
    && marker.receiptTimeMs === state.lastReceiptTimeMs
  ))?.eventRevision ?? null;
}

function phaseAt(
  state: Pick<UsdmPrivateLifecycleState,
  | 'leaseGeneration' | 'leaseDisposition' | 'leaseValidUntilMs' | 'generation'
  | 'connected' | 'authenticated' | 'subscribed' | 'connectionValidUntilMs'>,
  evaluatedAtMs: number,
): UsdmPrivateLifecyclePhase {
  if (state.leaseGeneration === 0 || state.leaseDisposition === 'ABSENT') return 'UNCONFIGURED';
  if (state.leaseDisposition === 'CLOSED') return 'LEASE_CLOSED';
  if (state.leaseDisposition === 'NOT_FOUND') return 'LEASE_NOT_FOUND';
  if (state.leaseDisposition === 'EXPIRED_BY_EVENT'
    || state.leaseDisposition === 'EXPIRED_BY_TIME'
    || state.leaseValidUntilMs === null || evaluatedAtMs > state.leaseValidUntilMs) {
    return 'LEASE_EXPIRED';
  }
  if (state.generation === 0) return 'LEASE_ACTIVE';
  if (state.connectionValidUntilMs === null || evaluatedAtMs >= state.connectionValidUntilMs) {
    return 'CONNECTION_EXPIRED';
  }
  if (!state.connected) return 'DISCONNECTED_LEASE_ACTIVE';
  if (state.subscribed) return 'SUBSCRIBED';
  if (state.authenticated) return 'ROUTE_AUTHENTICATED';
  return 'CONNECTED_UNAUTHENTICATED';
}

function continuityAt(
  state: Pick<UsdmPrivateLifecycleState,
  | 'ownerRestCut' | 'generation' | 'lastExchangeEventTimeMs'
  | 'lastContinuityBreakAtMs' | 'dedupeCoverageTruncated' | 'qualityPosture'>,
  freshness: UsdmRestReconciliationFreshness,
): UsdmContinuityPosture {
  const cut = state.ownerRestCut;
  // Truncation is an irreversible loss of the reducer's local dedupe proof.
  // A later owner cut may be fresh, but it cannot reconstruct evicted identities.
  if (cut !== null && freshness === 'FRESH' && !state.dedupeCoverageTruncated
    && state.qualityPosture === 'CLEAN'
    && (state.lastContinuityBreakAtMs === null
      || cut.reconciledAtMs >= state.lastContinuityBreakAtMs)
    && (state.lastExchangeEventTimeMs === null
      || cut.throughExchangeEventTimeMs >= state.lastExchangeEventTimeMs)) {
    return 'OWNER_CUT_COVERS_OBSERVED_EVENTS';
  }
  if (state.generation > 0 || state.lastContinuityBreakAtMs !== null) {
    return 'RECONCILIATION_REQUIRED';
  }
  return 'UNPROVED';
}

type UsdmStateCandidate = Omit<UsdmPrivateLifecycleState, 'stateContentRevision'>
  & Partial<Pick<UsdmPrivateLifecycleState, 'stateContentRevision'>>;

function freezeState(state: UsdmStateCandidate): Readonly<UsdmPrivateLifecycleState> {
  const { stateContentRevision: _discardedRevision, ...stateWithoutRevision } = state;
  const normalized = {
    ...stateWithoutRevision,
    eventWatermarks: Object.freeze(state.eventWatermarks.map((watermark) => Object.freeze({ ...watermark }))),
    recentEventMarkers: Object.freeze(state.recentEventMarkers.map((marker) => Object.freeze({ ...marker }))),
    lastAccountEvent: state.lastAccountEvent === null ? null : Object.freeze({ ...state.lastAccountEvent }),
    lastOrderEvent: state.lastOrderEvent === null ? null : Object.freeze({ ...state.lastOrderEvent }),
    lastFillEvent: state.lastFillEvent === null ? null : Object.freeze({ ...state.lastFillEvent }),
    recentEventRevisions: Object.freeze([...state.recentEventRevisions]),
    ownerRestCut: state.ownerRestCut === null ? null : Object.freeze({ ...state.ownerRestCut }),
  } as Omit<UsdmPrivateLifecycleState, 'stateContentRevision'>;
  return Object.freeze({
    ...normalized,
    stateContentRevision: usdmStateContentRevisionFor(normalized),
  });
}

function applied(state: UsdmPrivateLifecycleState): UsdmPrivateLifecycleDecision {
  const validated = validateUsdmPrivateLifecycleState(freezeState(state));
  return validated === null
    ? rejected(null, 'STATE_INVALID')
    : Object.freeze({ applied: true as const, state: validated });
}

function rejected(
  state: Readonly<UsdmPrivateLifecycleState> | null,
  reasonCode: UsdmPrivateLifecycleRejectReason,
): UsdmPrivateLifecycleDecision {
  return Object.freeze({ applied: false as const, state, reasonCode });
}

function sameEventMarker(
  left: Readonly<UsdmRecentEventMarker>,
  right: Readonly<UsdmRecentEventMarker>,
): boolean {
  return left.accountRealmId === right.accountRealmId
    && left.generation === right.generation
    && left.eventKind === right.eventKind
    && left.exchangeEventTimeMs === right.exchangeEventTimeMs
    && left.transactionTimeMs === right.transactionTimeMs
    && left.eventRevision === right.eventRevision
    && left.contentRevision === right.contentRevision
    && left.semanticCategory === right.semanticCategory
    && left.orderExecutionType === right.orderExecutionType
    && left.isFill === right.isFill
    && left.receiptTimeMs === right.receiptTimeMs;
}

function sameEventBaseIdentity(
  left: Readonly<UsdmRecentEventMarker>,
  right: Readonly<UsdmRecentEventMarker>,
): boolean {
  return left.accountRealmId === right.accountRealmId
    && left.generation === right.generation
    && left.eventKind === right.eventKind
    && left.exchangeEventTimeMs === right.exchangeEventTimeMs
    && left.transactionTimeMs === right.transactionTimeMs
    && left.semanticCategory === right.semanticCategory
    && left.orderExecutionType === right.orderExecutionType
    && left.isFill === right.isFill
    && left.receiptTimeMs === right.receiptTimeMs;
}

interface ReplayedUsdmPrivateMarkers {
  readonly eventWatermarks: readonly Readonly<UsdmPrivateEventWatermark>[];
  readonly lastPrivateEventKind: UsdmPrivateEventKind | null;
  readonly lastAccountEvent: Readonly<UsdmRecentEventMarker> | null;
  readonly lastOrderEvent: Readonly<UsdmRecentEventMarker> | null;
  readonly lastFillEvent: Readonly<UsdmRecentEventMarker> | null;
  readonly lastExchangeEventTimeMs: number | null;
  readonly lastTransactionTimeMs: number | null;
  readonly lastReceiptTimeMs: number | null;
}

/**
 * Rebuild every semantic summary that can be proven by an untruncated marker
 * window. Marker order is receipt order, so this deliberately mirrors the
 * reducer's same-type, cross-type and superseded-lease-expiry rules without
 * consulting any caller-supplied summary field.
 */
function replayUsdmPrivateMarkers(
  markers: readonly Readonly<UsdmRecentEventMarker>[],
  leaseObservedAtMs: number | null,
): ReplayedUsdmPrivateMarkers {
  let eventWatermarks: Readonly<UsdmPrivateEventWatermark>[] = [];
  let lastPrivateEventKind: UsdmPrivateEventKind | null = null;
  let lastAccountEvent: Readonly<UsdmRecentEventMarker> | null = null;
  let lastOrderEvent: Readonly<UsdmRecentEventMarker> | null = null;
  let lastFillEvent: Readonly<UsdmRecentEventMarker> | null = null;
  let lastExchangeEventTimeMs: number | null = null;
  let lastTransactionTimeMs: number | null = null;
  let lastReceiptTimeMs: number | null = null;

  for (const marker of markers) {
    const previousWatermark = eventWatermarks.find(
      (watermark) => watermark.eventKind === marker.eventKind,
    );
    const sameTypeOutOfOrder = previousWatermark !== undefined
      && (marker.exchangeEventTimeMs <= previousWatermark.exchangeEventTimeMs
        || (marker.transactionTimeMs !== null && previousWatermark.transactionTimeMs !== null
          && marker.transactionTimeMs <= previousWatermark.transactionTimeMs));
    const crossTypeOutOfOrder = lastExchangeEventTimeMs !== null
      && marker.exchangeEventTimeMs < lastExchangeEventTimeMs;
    const supersededLeaseExpiry = marker.eventKind === 'listenKeyExpired'
      && leaseObservedAtMs !== null
      && marker.exchangeEventTimeMs <= leaseObservedAtMs;
    if (sameTypeOutOfOrder || crossTypeOutOfOrder || supersededLeaseExpiry) continue;

    eventWatermarks = [
      ...eventWatermarks.filter((watermark) => watermark.eventKind !== marker.eventKind),
      Object.freeze({
        eventKind: marker.eventKind,
        exchangeEventTimeMs: marker.exchangeEventTimeMs,
        transactionTimeMs: marker.transactionTimeMs,
      }),
    ].sort((left, right) => (
      left.eventKind < right.eventKind ? -1 : left.eventKind > right.eventKind ? 1 : 0
    ));
    lastPrivateEventKind = marker.eventKind;
    lastExchangeEventTimeMs = marker.exchangeEventTimeMs;
    lastTransactionTimeMs = marker.transactionTimeMs;
    lastReceiptTimeMs = marker.receiptTimeMs;
    if (marker.semanticCategory === 'ACCOUNT') lastAccountEvent = marker;
    if (marker.semanticCategory === 'ORDER') lastOrderEvent = marker;
    if (marker.isFill) lastFillEvent = marker;
  }

  return Object.freeze({
    eventWatermarks: Object.freeze(eventWatermarks),
    lastPrivateEventKind,
    lastAccountEvent,
    lastOrderEvent,
    lastFillEvent,
    lastExchangeEventTimeMs,
    lastTransactionTimeMs,
    lastReceiptTimeMs,
  });
}

function sameWatermarks(
  left: readonly Readonly<UsdmPrivateEventWatermark>[],
  right: readonly Readonly<UsdmPrivateEventWatermark>[],
): boolean {
  return left.length === right.length && left.every((watermark, index) => {
    const expected = right[index];
    return expected !== undefined
      && watermark.eventKind === expected.eventKind
      && watermark.exchangeEventTimeMs === expected.exchangeEventTimeMs
      && watermark.transactionTimeMs === expected.transactionTimeMs;
  });
}

function sameNullableEventMarker(
  left: Readonly<UsdmRecentEventMarker> | null,
  right: Readonly<UsdmRecentEventMarker> | null,
): boolean {
  return left === null ? right === null : right !== null && sameEventMarker(left, right);
}

export function validateUsdmPrivateLifecycleState(
  value: unknown,
): Readonly<UsdmPrivateLifecycleState> | null {
  const record = snapshotClosedDataRecord(value, STATE_FIELDS);
  if (record === null) return null;
  const revisions = snapshotRevisionArray(record.recentEventRevisions);
  const watermarks = snapshotWatermarks(record.eventWatermarks);
  const markers = snapshotEventMarkers(record.recentEventMarkers);
  const lastAccountEvent = record.lastAccountEvent === null
    ? null : snapshotEventMarker(record.lastAccountEvent);
  const lastOrderEvent = record.lastOrderEvent === null
    ? null : snapshotEventMarker(record.lastOrderEvent);
  const lastFillEvent = record.lastFillEvent === null
    ? null : snapshotEventMarker(record.lastFillEvent);
  const cut = snapshotRestCut(record.ownerRestCut);
  if (revisions === null || watermarks === null || markers === null
    || (record.lastAccountEvent !== null && lastAccountEvent === null)
    || (record.lastOrderEvent !== null && lastOrderEvent === null)
    || (record.lastFillEvent !== null && lastFillEvent === null)
    || (record.ownerRestCut !== null && cut === null)
    || record.schema !== USDM_PRIVATE_LIFECYCLE_SCHEMA
    || record.version !== USDM_PRIVATE_LIFECYCLE_VERSION
    || record.matrixSha256 !== USDM_PRIVATE_MATRIX_SHA256
    || record.product !== 'USD_M_PERPETUAL' || record.environment !== 'PRODUCTION'
    || record.realm !== 'PRIVATE_USER_DATA' || !isAccountRealmId(record.accountRealmId)
    || typeof record.stateContentRevision !== 'string'
    || !STATE_CONTENT_REVISION_PATTERN.test(record.stateContentRevision)
    || !isCounter(record.revision)
    || !isCounter(record.leaseGeneration) || !isCounter(record.generation)
    || !includes(USDM_PRIVATE_LIFECYCLE_PHASES, record.phase)
    || !includes([
      'ABSENT', 'ACTIVE', 'CLOSED', 'NOT_FOUND', 'EXPIRED_BY_EVENT', 'EXPIRED_BY_TIME',
    ] as const, record.leaseDisposition)
    || (record.leaseObservedBy !== null
      && record.leaseObservedBy !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost
      && record.leaseObservedBy !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut
      && record.leaseObservedBy !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leaseDelete)
    || (record.routeClass !== null && !includes(USDM_PRIVATE_ROUTE_CLASSES, record.routeClass))
    || (record.routeContractId !== null && routeClassFor(record.routeContractId) === null)
    || typeof record.connected !== 'boolean' || typeof record.authenticated !== 'boolean'
    || typeof record.subscribed !== 'boolean' || typeof record.reconnectDue !== 'boolean'
    || typeof record.dedupeCoverageTruncated !== 'boolean'
    || !isTime(record.lastEvaluatedAtMs)
    || (record.lastPrivateEventKind !== null
      && !includes(USDM_PRIVATE_EVENT_KINDS, record.lastPrivateEventKind))
    || !isCounter(record.observedEventCount) || !isCounter(record.duplicateEventCount)
    || !isCounter(record.outOfOrderEventCount) || !isCounter(record.conflictingEventCount)
    || !isCounter(record.malformedEventCount) || !isCounter(record.staleGenerationEventCount)
    || (record.qualityPosture !== 'CLEAN'
      && record.qualityPosture !== 'CURRENT_GENERATION_DEGRADED')
    || !isCounter(record.listenKeyNotFoundCount) || !isCounter(record.reconnectCount)
    || !isCounter(record.closeCount)
    || !includes([
      'UNPROVED', 'RECONCILIATION_REQUIRED', 'OWNER_CUT_COVERS_OBSERVED_EVENTS',
    ] as const, record.continuityPosture)
    || !includes([
      'UNAVAILABLE', 'FRESH', 'STALE', 'GENERATION_MISMATCH', 'LAGGING_STREAM',
    ] as const, record.restReconciliationFreshness)
    || record.sequenceCompleteness !== 'UNKNOWN_NO_GLOBAL_SEQUENCE'
    || record.sendEligible !== false || record.externalActionAuthorization !== 'NONE'
    || record.actionAuthority !== 'NONE_RECORD_ONLY'
    || record.accountReadAuthorized !== false || record.mutationAuthorized !== false
    || record.reconciliationAuthority !== 'NONE' || record.capitalAuthority !== 'NONE'
    || record.riskAuthority !== 'NONE') return null;

  const nullableTimes = [
    record.leaseObservedAtMs, record.leaseValidUntilMs, record.renewBeforeMs,
    record.connectedAtMs, record.connectionValidUntilMs, record.reconnectBeforeMs,
    record.disconnectedAtMs, record.lastExchangeEventTimeMs, record.lastTransactionTimeMs,
    record.lastReceiptTimeMs, record.lastContinuityBreakAtMs,
    record.lastQualityLossAtMs,
  ];
  if (nullableTimes.some((time) => time !== null && !isTime(time))) return null;
  const lastEvaluatedAtMs = record.lastEvaluatedAtMs as number;
  const leaseObservedAtMs = record.leaseObservedAtMs as number | null;
  const connectedAtMs = record.connectedAtMs as number | null;
  const disconnectedAtMs = record.disconnectedAtMs as number | null;
  const lastContinuityBreakAtMs = record.lastContinuityBreakAtMs as number | null;
  const lastReceiptTimeMs = record.lastReceiptTimeMs as number | null;
  const lastQualityLossAtMs = record.lastQualityLossAtMs as number | null;
  if (record.lastContinuityBreakAtMs !== null
    && (lastContinuityBreakAtMs as number) > lastEvaluatedAtMs) return null;
  if (lastQualityLossAtMs !== null && lastQualityLossAtMs > lastEvaluatedAtMs) return null;

  if (record.leaseGeneration === 0) {
    if (record.leaseDisposition !== 'ABSENT' || record.leaseObservedBy !== null
      || record.leaseObservedAtMs !== null || record.leaseValidUntilMs !== null
      || record.renewBeforeMs !== null || record.generation !== 0) return null;
  } else if (record.leaseDisposition === 'ACTIVE') {
    if ((record.leaseObservedBy !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost
      && record.leaseObservedBy !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut)
      || record.leaseObservedAtMs === null || record.leaseValidUntilMs === null
      || record.renewBeforeMs === null
      || (leaseObservedAtMs as number) > lastEvaluatedAtMs
      || addLifetime(record.leaseObservedAtMs as number, USDM_LISTEN_KEY_LIFETIME_MS)
        !== record.leaseValidUntilMs
      || record.renewBeforeMs !== (record.leaseValidUntilMs as number) - 1
      || record.lastEvaluatedAtMs > (record.leaseValidUntilMs as number)) return null;
  } else {
    if (leaseObservedAtMs === null || leaseObservedAtMs > lastEvaluatedAtMs
      || record.leaseValidUntilMs !== null || record.renewBeforeMs !== null) return null;
    if (record.leaseDisposition === 'CLOSED'
      && record.leaseObservedBy !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leaseDelete) return null;
    if (record.leaseDisposition === 'NOT_FOUND'
      && record.leaseObservedBy !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut) return null;
    if ((record.leaseDisposition === 'EXPIRED_BY_EVENT'
      || record.leaseDisposition === 'EXPIRED_BY_TIME')
      && record.leaseObservedBy !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost
      && record.leaseObservedBy !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut) return null;
  }

  if (record.routeContractId !== routeContractFor(record.routeClass as UsdmPrivateRouteClass | null)) {
    return null;
  }
  if (record.generation === 0) {
    if (record.routeClass !== null || record.connected || record.authenticated || record.subscribed
      || record.connectedAtMs !== null || record.connectionValidUntilMs !== null
      || record.reconnectBeforeMs !== null || record.reconnectDue
      || record.disconnectedAtMs !== null || cut !== null
      || watermarks.length !== 0 || markers.length !== 0 || revisions.length !== 0
      || lastAccountEvent !== null || lastOrderEvent !== null || lastFillEvent !== null
      || record.lastPrivateEventKind !== null || record.lastExchangeEventTimeMs !== null
      || record.lastTransactionTimeMs !== null || record.lastReceiptTimeMs !== null
      || record.observedEventCount !== 0 || record.duplicateEventCount !== 0
      || record.outOfOrderEventCount !== 0 || record.conflictingEventCount !== 0
      || record.malformedEventCount !== 0 || record.staleGenerationEventCount !== 0
      || record.dedupeCoverageTruncated || record.qualityPosture !== 'CLEAN'
      || record.lastQualityLossAtMs !== null) return null;
  } else if (record.routeClass === null || record.connectedAtMs === null
    || record.connectionValidUntilMs === null || record.reconnectBeforeMs === null
    || record.leaseGeneration === 0
    || (connectedAtMs as number) > lastEvaluatedAtMs
    || addLifetime(record.connectedAtMs as number, USDM_PRIVATE_CONNECTION_LIFETIME_MS)
      !== record.connectionValidUntilMs
    || (record.reconnectBeforeMs as number) <= (record.connectedAtMs as number)
    || (record.reconnectBeforeMs as number) >= (record.connectionValidUntilMs as number)
    || record.reconnectCount !== record.generation - 1
    || record.lastContinuityBreakAtMs === null
    || (lastContinuityBreakAtMs as number) < (connectedAtMs as number)) return null;
  if (record.authenticated && !record.connected) return null;
  if (record.subscribed && (!record.connected || !record.authenticated)) return null;
  if (record.generation > 0 && (record.connected
    ? disconnectedAtMs !== null
      || lastEvaluatedAtMs >= (record.connectionValidUntilMs as number)
    : disconnectedAtMs === null
      || disconnectedAtMs < (connectedAtMs as number)
      || disconnectedAtMs > lastEvaluatedAtMs
      || record.authenticated || record.subscribed)) return null;
  if (record.generation > 0 && (record.connected
    ? record.reconnectDue !== (record.lastEvaluatedAtMs >= (record.reconnectBeforeMs as number))
    : !record.reconnectDue)) return null;
  const semanticMarkers = [lastAccountEvent, lastOrderEvent, lastFillEvent]
    .filter((marker): marker is Readonly<UsdmRecentEventMarker> => marker !== null);
  if (semanticMarkers.some((marker) => marker.accountRealmId !== record.accountRealmId
    || marker.generation !== record.generation
    || marker.receiptTimeMs < (connectedAtMs ?? 0)
    || marker.receiptTimeMs > lastEvaluatedAtMs)
    || markers.some((marker) => marker.accountRealmId !== record.accountRealmId
      || marker.generation !== record.generation
      || marker.receiptTimeMs < (connectedAtMs ?? 0)
      || marker.receiptTimeMs > lastEvaluatedAtMs)
    || (lastAccountEvent !== null && lastAccountEvent.semanticCategory !== 'ACCOUNT')
    || (lastOrderEvent !== null && lastOrderEvent.semanticCategory !== 'ORDER')
    || (lastFillEvent !== null && !lastFillEvent.isFill)) return null;

  if (!record.dedupeCoverageTruncated && semanticMarkers.some((semanticMarker) => (
    !markers.some((marker) => sameEventMarker(marker, semanticMarker))
  ))) return null;
  if (semanticMarkers.some((semanticMarker) => {
    const watermark = watermarks.find((item) => item.eventKind === semanticMarker.eventKind);
    return watermark === undefined
      || semanticMarker.exchangeEventTimeMs > watermark.exchangeEventTimeMs;
  })) return null;

  const lastEventEmpty = record.lastPrivateEventKind === null;
  if (lastEventEmpty) {
    if (record.lastExchangeEventTimeMs !== null || record.lastTransactionTimeMs !== null
      || record.lastReceiptTimeMs !== null || watermarks.length !== 0
      || lastAccountEvent !== null || lastOrderEvent !== null || lastFillEvent !== null) return null;
    if (markers.length > record.outOfOrderEventCount) return null;
  } else {
    if (record.lastExchangeEventTimeMs === null || record.lastReceiptTimeMs === null
      || (lastReceiptTimeMs as number) > lastEvaluatedAtMs) return null;
    const watermark = watermarks.find((item) => item.eventKind === record.lastPrivateEventKind);
    if (watermark === undefined
      || watermark.exchangeEventTimeMs !== record.lastExchangeEventTimeMs
      || watermark.transactionTimeMs !== record.lastTransactionTimeMs) return null;
    if (!record.dedupeCoverageTruncated && !markers.some((marker) => (
      marker.eventKind === record.lastPrivateEventKind
      && marker.exchangeEventTimeMs === record.lastExchangeEventTimeMs
      && marker.transactionTimeMs === record.lastTransactionTimeMs
      && marker.receiptTimeMs === record.lastReceiptTimeMs
    ))) return null;
  }
  if (record.leaseDisposition === 'EXPIRED_BY_EVENT'
    && record.lastPrivateEventKind !== 'listenKeyExpired') return null;
  if (record.observedEventCount < revisions.length
    || markers.length !== revisions.length
    || markers.some((marker, index) => marker.eventRevision !== revisions[index])
    || markers.some((marker, index) => index > 0
      && marker.receiptTimeMs < (markers[index - 1] as Readonly<UsdmRecentEventMarker>).receiptTimeMs)
    || record.observedEventCount < markers.length
      + record.duplicateEventCount + record.conflictingEventCount
    || record.duplicateEventCount > record.observedEventCount
    || record.outOfOrderEventCount > record.observedEventCount
    || record.conflictingEventCount > record.observedEventCount
    || (!record.dedupeCoverageTruncated
      && (record.malformedEventCount > 0
        || record.observedEventCount !== markers.length
          + record.duplicateEventCount + record.conflictingEventCount
        || record.observedEventCount > USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS
        || markers.length >= USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS))) return null;
  const hasQualityLoss = record.dedupeCoverageTruncated
    || record.outOfOrderEventCount > 0
    || record.conflictingEventCount > 0
    || record.malformedEventCount > 0
    || record.staleGenerationEventCount > 0;
  if (hasQualityLoss !== (lastQualityLossAtMs !== null)
    || record.qualityPosture !== (hasQualityLoss ? 'CURRENT_GENERATION_DEGRADED' : 'CLEAN')) {
    return null;
  }
  if (!record.dedupeCoverageTruncated) {
    const replayed = replayUsdmPrivateMarkers(markers, leaseObservedAtMs);
    if (!sameWatermarks(watermarks, replayed.eventWatermarks)
      || record.lastPrivateEventKind !== replayed.lastPrivateEventKind
      || !sameNullableEventMarker(lastAccountEvent, replayed.lastAccountEvent)
      || !sameNullableEventMarker(lastOrderEvent, replayed.lastOrderEvent)
      || !sameNullableEventMarker(lastFillEvent, replayed.lastFillEvent)
      || record.lastExchangeEventTimeMs !== replayed.lastExchangeEventTimeMs
      || record.lastTransactionTimeMs !== replayed.lastTransactionTimeMs
      || record.lastReceiptTimeMs !== replayed.lastReceiptTimeMs) return null;
  }
  if (cut !== null && (cut.accountRealmId !== record.accountRealmId
    || cut.generation < 1 || cut.generation > record.generation
    || cut.reconciledAtMs < (connectedAtMs ?? 0)
    || cut.reconciledAtMs > record.lastEvaluatedAtMs)) return null;
  if (cut !== null) {
    const coveredMarker = cut.throughEventRevision === null
      ? null
      : markers.find((marker) => marker.eventRevision === cut.throughEventRevision) ?? null;
    if (cut.throughEventRevision !== null
      && ((coveredMarker === null && !record.dedupeCoverageTruncated)
        || (coveredMarker !== null
          && cut.throughExchangeEventTimeMs !== coveredMarker.exchangeEventTimeMs))) return null;
  }
  const freshness = restFreshness(
    cut,
    record.generation,
    record.lastEvaluatedAtMs,
    record.lastExchangeEventTimeMs as number | null,
    currentUsdmEventRevision({
      ...(record as unknown as UsdmPrivateLifecycleState),
      recentEventMarkers: markers,
    }),
  );
  if (record.restReconciliationFreshness !== freshness) return null;
  const continuity = continuityAt({
    ownerRestCut: cut,
    generation: record.generation,
    lastExchangeEventTimeMs: record.lastExchangeEventTimeMs as number | null,
    lastContinuityBreakAtMs: record.lastContinuityBreakAtMs as number | null,
    dedupeCoverageTruncated: record.dedupeCoverageTruncated,
    qualityPosture: record.qualityPosture as UsdmPrivateQualityPosture,
  }, freshness);
  if (record.continuityPosture !== continuity
    || record.phase !== phaseAt(record as unknown as UsdmPrivateLifecycleState,
      record.lastEvaluatedAtMs)) return null;

  const normalized = freezeState({
    ...(record as unknown as UsdmPrivateLifecycleState),
    eventWatermarks: watermarks,
    recentEventMarkers: markers,
    lastAccountEvent,
    lastOrderEvent,
    lastFillEvent,
    recentEventRevisions: revisions,
    ownerRestCut: cut,
  });
  return record.stateContentRevision === normalized.stateContentRevision ? normalized : null;
}

function withEvaluation(
  state: Readonly<UsdmPrivateLifecycleState>,
  evaluatedAtMs: number,
  patch: Partial<UsdmPrivateLifecycleState>,
): UsdmPrivateLifecycleState | null {
  const revision = increment(state.revision);
  if (revision === null) return null;
  const patched = {
    ...state,
    ...patch,
    revision,
    lastEvaluatedAtMs: evaluatedAtMs,
  } as UsdmPrivateLifecycleState;
  // Accepted observations may bypass the active-lease gate (for example a
  // fenced stale-generation event, an owner REST cut or a physical close).
  // Normalize the inclusive lease boundary here so no accepted decision can
  // emit an ACTIVE state whose own evaluation time is already beyond expiry.
  const leaseNormalized = patched.leaseDisposition === 'ACTIVE'
    && patched.leaseValidUntilMs !== null
    && evaluatedAtMs > patched.leaseValidUntilMs
    ? {
        ...patched,
        leaseDisposition: 'EXPIRED_BY_TIME' as const,
        leaseValidUntilMs: null,
        renewBeforeMs: null,
        authenticated: false,
        subscribed: false,
        lastContinuityBreakAtMs: evaluatedAtMs,
      }
    : patched;
  // The WebSocket lifetime is exclusive at its exact 24-hour boundary. Apply
  // that law on every accepted observation, including lease and REST evidence
  // that intentionally bypasses the stream-action gate.
  const candidate = leaseNormalized.connected
    && leaseNormalized.connectionValidUntilMs !== null
    && evaluatedAtMs >= leaseNormalized.connectionValidUntilMs
    ? {
        ...leaseNormalized,
        connected: false,
        authenticated: false,
        subscribed: false,
        disconnectedAtMs: evaluatedAtMs,
        reconnectDue: true,
        lastContinuityBreakAtMs: evaluatedAtMs,
      }
    : leaseNormalized;
  const reconnectDue = candidate.generation === 0
    ? false
    : candidate.connected
      ? evaluatedAtMs >= (candidate.reconnectBeforeMs as number)
      : true;
  const freshness = restFreshness(
    candidate.ownerRestCut,
    candidate.generation,
    evaluatedAtMs,
    candidate.lastExchangeEventTimeMs,
    currentUsdmEventRevision(candidate),
  );
  const evaluated = {
    ...candidate,
    reconnectDue,
    phase: phaseAt(candidate, evaluatedAtMs),
    restReconciliationFreshness: freshness,
    qualityPosture: candidate.lastQualityLossAtMs === null
      ? 'CLEAN' as const
      : 'CURRENT_GENERATION_DEGRADED' as const,
  } as UsdmPrivateLifecycleState;
  return {
    ...evaluated,
    continuityPosture: continuityAt(evaluated, freshness),
  };
}

/** Create an inert USD-M private-stream lifecycle state. */
export function createInitialUsdmPrivateLifecycleState(
  evaluatedAtMs: number,
  accountRealmId: string = USDM_PRIVATE_DEFAULT_ACCOUNT_REALM_ID,
): Readonly<UsdmPrivateLifecycleState> {
  if (!isTime(evaluatedAtMs)) throw new TypeError('USD-M lifecycle time must be a safe integer');
  if (!isAccountRealmId(accountRealmId)) {
    throw new TypeError('USD-M lifecycle accountRealmId must be a namespaced account realm');
  }
  return freezeState({
    schema: USDM_PRIVATE_LIFECYCLE_SCHEMA,
    version: USDM_PRIVATE_LIFECYCLE_VERSION,
    matrixSha256: USDM_PRIVATE_MATRIX_SHA256,
    product: 'USD_M_PERPETUAL',
    environment: 'PRODUCTION',
    realm: 'PRIVATE_USER_DATA',
    accountRealmId,
    revision: 0,
    leaseGeneration: 0,
    leaseDisposition: 'ABSENT',
    leaseObservedBy: null,
    leaseObservedAtMs: null,
    leaseValidUntilMs: null,
    renewBeforeMs: null,
    generation: 0,
    phase: 'UNCONFIGURED',
    routeClass: null,
    routeContractId: null,
    connected: false,
    authenticated: false,
    subscribed: false,
    connectedAtMs: null,
    connectionValidUntilMs: null,
    reconnectBeforeMs: null,
    reconnectDue: false,
    disconnectedAtMs: null,
    lastEvaluatedAtMs: evaluatedAtMs,
    lastPrivateEventKind: null,
    lastAccountEvent: null,
    lastOrderEvent: null,
    lastFillEvent: null,
    lastExchangeEventTimeMs: null,
    lastTransactionTimeMs: null,
    lastReceiptTimeMs: null,
    eventWatermarks: Object.freeze([]),
    recentEventMarkers: Object.freeze([]),
    recentEventRevisions: Object.freeze([]),
    dedupeCoverageTruncated: false,
    observedEventCount: 0,
    duplicateEventCount: 0,
    outOfOrderEventCount: 0,
    conflictingEventCount: 0,
    malformedEventCount: 0,
    staleGenerationEventCount: 0,
    qualityPosture: 'CLEAN',
    lastQualityLossAtMs: null,
    listenKeyNotFoundCount: 0,
    reconnectCount: 0,
    closeCount: 0,
    lastContinuityBreakAtMs: null,
    continuityPosture: 'UNPROVED',
    ownerRestCut: null,
    restReconciliationFreshness: 'UNAVAILABLE',
    sequenceCompleteness: 'UNKNOWN_NO_GLOBAL_SEQUENCE',
    sendEligible: false,
    externalActionAuthorization: 'NONE',
    actionAuthority: 'NONE_RECORD_ONLY',
    accountReadAuthorized: false,
    mutationAuthorized: false,
    reconciliationAuthority: 'NONE',
    capitalAuthority: 'NONE',
    riskAuthority: 'NONE',
  });
}

/** Apply one injected observation without performing any external action. */
export function reduceUsdmPrivateLifecycle(
  stateValue: unknown,
  actionValue: unknown,
): UsdmPrivateLifecycleDecision {
  const state = validateUsdmPrivateLifecycleState(stateValue);
  if (state === null) return rejected(null, 'STATE_INVALID');
  const action = snapshotAction(actionValue);
  if (action === null) return rejected(state, 'ACTION_INVALID');
  if (!isAccountRealmId(action.accountRealmId)) return rejected(state, 'ACTION_INVALID');
  if (action.accountRealmId !== state.accountRealmId) {
    return rejected(state, 'ACCOUNT_REALM_MISMATCH');
  }

  const actionTime = action.kind === 'PRIVATE_EVENT_OBSERVED'
    || action.kind === 'MALFORMED_EVENT_OBSERVED'
    ? action.receiptTimeMs
    : action.kind === 'OWNER_REST_RECONCILIATION_OBSERVED'
      ? action.reconciledAtMs
      : action.kind === 'EVALUATED'
        ? action.evaluatedAtMs
        : action.observedAtMs;
  if (!isTime(actionTime)) return rejected(state, 'ACTION_INVALID');
  if (actionTime < state.lastEvaluatedAtMs) return rejected(state, 'TIME_REGRESSION');

  let normalizedPrivateEventMarker: Readonly<UsdmRecentEventMarker> | null = null;
  if (action.kind === 'PRIVATE_EVENT_OBSERVED') {
    const normalized = normalizeUsdmPrivateEventAction(action);
    if (normalized.reasonCode !== null) return rejected(state, normalized.reasonCode);
    normalizedPrivateEventMarker = normalized.marker;
  }

  if (action.kind === 'EVALUATED') {
    const connectionExpired = state.connectionValidUntilMs !== null
      && actionTime >= state.connectionValidUntilMs;
    const leaseExpired = state.leaseDisposition === 'ACTIVE'
      && state.leaseValidUntilMs !== null && actionTime > state.leaseValidUntilMs;
    const next = withEvaluation(state, actionTime, {
      ...(leaseExpired ? {
        leaseDisposition: 'EXPIRED_BY_TIME' as const,
        leaseValidUntilMs: null,
        renewBeforeMs: null,
        authenticated: false,
        subscribed: false,
        lastContinuityBreakAtMs: actionTime,
      } : {}),
      ...(connectionExpired ? {
        connected: false,
        authenticated: false,
        subscribed: false,
        disconnectedAtMs: actionTime,
        reconnectDue: true,
        lastContinuityBreakAtMs: actionTime,
      } : state.connected && state.reconnectBeforeMs !== null ? {
        reconnectDue: actionTime >= state.reconnectBeforeMs,
      } : {}),
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (action.kind === 'LEASE_POST_OBSERVED') {
    if (action.contractId !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePost
      || !isCounter(action.leaseGeneration) || action.leaseGeneration < 1) {
      return rejected(state, 'ACTION_INVALID');
    }
    const active = state.leaseDisposition === 'ACTIVE'
      && state.leaseValidUntilMs !== null && actionTime <= state.leaseValidUntilMs;
    const expectedGeneration = active ? state.leaseGeneration : state.leaseGeneration + 1;
    if (!isCounter(expectedGeneration)) return rejected(state, 'COUNTER_LIMIT_REACHED');
    if (action.leaseGeneration !== expectedGeneration) {
      return rejected(state, 'LEASE_GENERATION_MISMATCH');
    }
    const validUntil = addLifetime(actionTime, USDM_LISTEN_KEY_LIFETIME_MS);
    if (validUntil === null) return rejected(state, 'TIME_OVERFLOW');
    const generationChanged = action.leaseGeneration !== state.leaseGeneration;
    const next = withEvaluation(state, actionTime, {
      leaseGeneration: action.leaseGeneration,
      leaseDisposition: 'ACTIVE',
      leaseObservedBy: action.contractId,
      leaseObservedAtMs: actionTime,
      leaseValidUntilMs: validUntil,
      renewBeforeMs: validUntil - 1,
      ...(generationChanged ? {
        connected: false,
        authenticated: false,
        subscribed: false,
        disconnectedAtMs: state.generation === 0 ? null : actionTime,
        reconnectDue: state.generation > 0,
        lastPrivateEventKind: null,
        lastAccountEvent: null,
        lastOrderEvent: null,
        lastFillEvent: null,
        lastExchangeEventTimeMs: null,
        lastTransactionTimeMs: null,
        lastReceiptTimeMs: null,
        eventWatermarks: Object.freeze([]),
        recentEventMarkers: Object.freeze([]),
        recentEventRevisions: Object.freeze([]),
        dedupeCoverageTruncated: false,
        observedEventCount: 0,
        duplicateEventCount: 0,
        outOfOrderEventCount: 0,
        conflictingEventCount: 0,
        malformedEventCount: 0,
        staleGenerationEventCount: 0,
        qualityPosture: 'CLEAN',
        lastQualityLossAtMs: null,
        ownerRestCut: null,
        lastContinuityBreakAtMs: state.generation === 0 ? state.lastContinuityBreakAtMs : actionTime,
      } : {}),
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (action.kind === 'LEASE_PUT_OBSERVED') {
    if (action.contractId !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut
      || !isCounter(action.leaseGeneration) || action.leaseGeneration < 1) {
      return rejected(state, 'ACTION_INVALID');
    }
    if (action.leaseGeneration !== state.leaseGeneration) {
      return rejected(state, 'LEASE_GENERATION_MISMATCH');
    }
    if (state.leaseDisposition !== 'ACTIVE' || state.leaseValidUntilMs === null) {
      return rejected(state, 'LEASE_REQUIRED');
    }
    if (actionTime > state.leaseValidUntilMs) return rejected(state, 'LEASE_EXPIRED');
    const validUntil = addLifetime(actionTime, USDM_LISTEN_KEY_LIFETIME_MS);
    if (validUntil === null) return rejected(state, 'TIME_OVERFLOW');
    const next = withEvaluation(state, actionTime, {
      leaseObservedBy: action.contractId,
      leaseObservedAtMs: actionTime,
      leaseValidUntilMs: validUntil,
      renewBeforeMs: validUntil - 1,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (action.kind === 'LEASE_DELETE_OBSERVED') {
    if (action.contractId !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leaseDelete
      || !isCounter(action.leaseGeneration) || action.leaseGeneration < 1) {
      return rejected(state, 'ACTION_INVALID');
    }
    if (action.leaseGeneration !== state.leaseGeneration) {
      return rejected(state, 'LEASE_GENERATION_MISMATCH');
    }
    if (state.leaseDisposition !== 'ACTIVE') return rejected(state, 'LEASE_REQUIRED');
    const closeCount = increment(state.closeCount);
    if (closeCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
    const next = withEvaluation(state, actionTime, {
      leaseDisposition: 'CLOSED',
      leaseObservedBy: action.contractId,
      leaseObservedAtMs: actionTime,
      leaseValidUntilMs: null,
      renewBeforeMs: null,
      authenticated: false,
      subscribed: false,
      closeCount,
      lastContinuityBreakAtMs: actionTime,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (action.kind === 'LEASE_NOT_FOUND_OBSERVED') {
    if (action.contractId !== USDM_PRIVATE_DOCUMENTARY_CONTRACTS.leasePut
      || action.errorCode !== -1125 || !isCounter(action.leaseGeneration)
      || action.leaseGeneration < 1) return rejected(state, 'ACTION_INVALID');
    if (action.leaseGeneration !== state.leaseGeneration) {
      return rejected(state, 'LEASE_GENERATION_MISMATCH');
    }
    const listenKeyNotFoundCount = increment(state.listenKeyNotFoundCount);
    if (listenKeyNotFoundCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
    const next = withEvaluation(state, actionTime, {
      leaseDisposition: 'NOT_FOUND',
      leaseObservedBy: action.contractId,
      leaseObservedAtMs: actionTime,
      leaseValidUntilMs: null,
      renewBeforeMs: null,
      authenticated: false,
      subscribed: false,
      listenKeyNotFoundCount,
      lastContinuityBreakAtMs: actionTime,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (action.kind === 'CONNECTION_OPENED') {
    const routeClass = routeClassFor(action.contractId);
    if (routeClass === null) return rejected(state, 'ROUTE_CONTRACT_MISMATCH');
    if (!isCounter(action.generation) || action.generation < 1
      || !isTime(action.reconnectBeforeMs)) return rejected(state, 'ACTION_INVALID');
    if (state.leaseDisposition !== 'ACTIVE' || state.leaseValidUntilMs === null) {
      return rejected(state, 'LEASE_REQUIRED');
    }
    if (actionTime > state.leaseValidUntilMs) return rejected(state, 'LEASE_EXPIRED');
    if (action.generation !== state.generation + 1) {
      return rejected(state, 'CONNECTION_GENERATION_MISMATCH');
    }
    if (state.connected) return rejected(state, 'CONNECTION_ALREADY_OPEN');
    const validUntil = addLifetime(actionTime, USDM_PRIVATE_CONNECTION_LIFETIME_MS);
    if (validUntil === null) return rejected(state, 'TIME_OVERFLOW');
    if (action.reconnectBeforeMs <= actionTime || action.reconnectBeforeMs >= validUntil) {
      return rejected(state, 'RECONNECT_PLAN_INVALID');
    }
    const reconnectCount = state.generation === 0 ? state.reconnectCount : increment(state.reconnectCount);
    if (reconnectCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
    const next = withEvaluation(state, actionTime, {
      generation: action.generation,
      routeClass,
      routeContractId: action.contractId as UsdmPrivateRouteContractId,
      connected: true,
      authenticated: false,
      subscribed: false,
      connectedAtMs: actionTime,
      connectionValidUntilMs: validUntil,
      reconnectBeforeMs: action.reconnectBeforeMs,
      reconnectDue: false,
      disconnectedAtMs: null,
      lastPrivateEventKind: null,
      lastAccountEvent: null,
      lastOrderEvent: null,
      lastFillEvent: null,
      lastExchangeEventTimeMs: null,
      lastTransactionTimeMs: null,
      lastReceiptTimeMs: null,
      eventWatermarks: Object.freeze([]),
      recentEventMarkers: Object.freeze([]),
      recentEventRevisions: Object.freeze([]),
      dedupeCoverageTruncated: false,
      observedEventCount: 0,
      duplicateEventCount: 0,
      outOfOrderEventCount: 0,
      conflictingEventCount: 0,
      malformedEventCount: 0,
      staleGenerationEventCount: 0,
      qualityPosture: 'CLEAN',
      lastQualityLossAtMs: null,
      ownerRestCut: null,
      reconnectCount,
      lastContinuityBreakAtMs: actionTime,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (action.kind === 'OWNER_REST_RECONCILIATION_OBSERVED') {
    if (!isCounter(action.generation) || action.generation < 1 || state.generation < 1
      || !isTime(action.validUntilMs)
      || (action.throughEventRevision !== null
        && (typeof action.throughEventRevision !== 'string'
          || !EVENT_REVISION_PATTERN.test(action.throughEventRevision)))
      || !isTime(action.throughExchangeEventTimeMs)
      || typeof action.reconciliationRevision !== 'string'
      || !RECONCILIATION_REVISION_PATTERN.test(action.reconciliationRevision)
      || action.validUntilMs < actionTime
      || action.validUntilMs - actionTime > USDM_OWNER_REST_MAXIMUM_FRESHNESS_MS
      || action.throughExchangeEventTimeMs > actionTime) {
      return rejected(state, 'REST_CUT_INVALID');
    }
    if (action.reconciliationRevision !== usdmRestRevisionFor({
      accountRealmId: state.accountRealmId,
      generation: action.generation,
      reconciledAtMs: actionTime,
      validUntilMs: action.validUntilMs,
      throughExchangeEventTimeMs: action.throughExchangeEventTimeMs,
      throughEventRevision: action.throughEventRevision as string | null,
    })) return rejected(state, 'REST_CUT_INVALID');
    if (action.generation !== state.generation) {
      return rejected(state, 'CONNECTION_GENERATION_MISMATCH');
    }
    const coveredMarker = action.throughEventRevision === null
      ? null
      : state.recentEventMarkers.find(
        (marker) => marker.eventRevision === action.throughEventRevision,
      ) ?? null;
    if ((action.throughEventRevision === null && state.lastPrivateEventKind !== null)
      || (action.throughEventRevision !== null
        && (coveredMarker === null
          || action.throughExchangeEventTimeMs !== coveredMarker.exchangeEventTimeMs))) {
      return rejected(state, 'REST_CUT_INVALID');
    }
    const priorCut = state.ownerRestCut;
    if (priorCut !== null
      && priorCut.reconciliationRevision === action.reconciliationRevision) {
      const exactDuplicate = priorCut.generation === action.generation
        && priorCut.accountRealmId === state.accountRealmId
        && priorCut.reconciledAtMs === actionTime
        && priorCut.validUntilMs === action.validUntilMs
        && priorCut.throughEventRevision === action.throughEventRevision
        && priorCut.throughExchangeEventTimeMs === action.throughExchangeEventTimeMs;
      if (!exactDuplicate) return rejected(state, 'REST_REVISION_CONFLICT');
      // Re-observing one semantic owner revision may advance evaluation time
      // (and therefore age it), but can never refresh or rewrite the cut.
      const next = withEvaluation(state, actionTime, {});
      return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
    }
    const ownerRestCut = Object.freeze({
      accountRealmId: state.accountRealmId,
      generation: action.generation,
      reconciliationRevision: action.reconciliationRevision,
      reconciledAtMs: actionTime,
      validUntilMs: action.validUntilMs,
      throughEventRevision: action.throughEventRevision as string | null,
      throughExchangeEventTimeMs: action.throughExchangeEventTimeMs,
    });
    const next = withEvaluation(state, actionTime, { ownerRestCut });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (!isCounter(action.generation) || action.generation < 1) {
    return rejected(state, 'ACTION_INVALID');
  }

  if (action.kind === 'PRIVATE_EVENT_OBSERVED'
    || action.kind === 'MALFORMED_EVENT_OBSERVED') {
    if (action.generation < state.generation) {
      const staleGenerationEventCount = increment(state.staleGenerationEventCount);
      if (staleGenerationEventCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
      const next = withEvaluation(state, actionTime, {
        staleGenerationEventCount,
        lastQualityLossAtMs: actionTime,
      });
      return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
    }
  }
  if (action.generation !== state.generation) {
    return rejected(state, 'CONNECTION_GENERATION_MISMATCH');
  }
  if (!state.connected || state.connectedAtMs === null || state.connectionValidUntilMs === null) {
    return rejected(state, 'CONNECTION_REQUIRED');
  }
  if (actionTime >= state.connectionValidUntilMs) return rejected(state, 'CONNECTION_EXPIRED');

  // A transport-close observation describes the physical connection. It remains
  // recordable after the independent listen-key lease was closed, lost or expired.
  if (action.kind === 'CONNECTION_CLOSED') {
    if (action.reason !== 'TRANSPORT_CLOSED' && action.reason !== 'PLANNED_RECONNECT'
      && action.reason !== 'REMOTE_CLOSED') return rejected(state, 'ACTION_INVALID');
    const next = withEvaluation(state, actionTime, {
      connected: false,
      authenticated: false,
      subscribed: false,
      disconnectedAtMs: actionTime,
      reconnectDue: true,
      lastContinuityBreakAtMs: actionTime,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (state.leaseDisposition !== 'ACTIVE' || state.leaseValidUntilMs === null) {
    return rejected(state, 'LEASE_REQUIRED');
  }
  if (actionTime > state.leaseValidUntilMs) return rejected(state, 'LEASE_EXPIRED');

  if (action.kind === 'ROUTE_AUTHENTICATED') {
    if (action.contractId !== state.routeContractId) return rejected(state, 'ROUTE_CONTRACT_MISMATCH');
    const next = withEvaluation(state, actionTime, { authenticated: true });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (action.kind === 'STREAM_SUBSCRIBED') {
    if (action.contractId !== state.routeContractId) return rejected(state, 'ROUTE_CONTRACT_MISMATCH');
    if (!state.authenticated) return rejected(state, 'AUTHENTICATION_REQUIRED');
    const next = withEvaluation(state, actionTime, { subscribed: true });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (!state.authenticated) return rejected(state, 'AUTHENTICATION_REQUIRED');
  if (!state.subscribed) return rejected(state, 'SUBSCRIPTION_REQUIRED');

  if (action.kind === 'MALFORMED_EVENT_OBSERVED') {
    const malformedEventCount = increment(state.malformedEventCount);
    if (malformedEventCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
    const next = withEvaluation(state, actionTime, {
      malformedEventCount,
      dedupeCoverageTruncated: true,
      lastContinuityBreakAtMs: actionTime,
      lastQualityLossAtMs: actionTime,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  if (action.kind !== 'PRIVATE_EVENT_OBSERVED' || normalizedPrivateEventMarker === null) {
    return rejected(state, 'ACTION_INVALID');
  }
  const normalizedEvent = normalizedPrivateEventMarker;

  const observedEventCount = increment(state.observedEventCount);
  if (observedEventCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
  const semantics = Object.freeze({
    semanticCategory: normalizedEvent.semanticCategory,
    orderExecutionType: normalizedEvent.orderExecutionType,
    isFill: normalizedEvent.isFill,
  });

  const existingMarker = state.recentEventMarkers.find(
    (marker) => marker.eventRevision === normalizedEvent.eventRevision
      || sameEventBaseIdentity(marker, normalizedEvent),
  );
  if (existingMarker !== undefined) {
    const exactDuplicate = sameEventMarker(existingMarker, normalizedEvent);
    if (!exactDuplicate) {
      const conflictingEventCount = increment(state.conflictingEventCount);
      if (conflictingEventCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
      const next = withEvaluation(state, actionTime, {
        observedEventCount,
        conflictingEventCount,
        ...(observedEventCount > USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS ? {
          dedupeCoverageTruncated: true,
        } : {}),
        lastContinuityBreakAtMs: actionTime,
        lastQualityLossAtMs: actionTime,
      });
      return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
    }
    const duplicateEventCount = increment(state.duplicateEventCount);
    if (duplicateEventCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
    const coverageWillTruncate = observedEventCount
      > USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS;
    const next = withEvaluation(state, actionTime, {
      observedEventCount,
      duplicateEventCount,
      ...(coverageWillTruncate ? {
        dedupeCoverageTruncated: true,
        lastContinuityBreakAtMs: actionTime,
        lastQualityLossAtMs: actionTime,
      } : {}),
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  const previousWatermark = state.eventWatermarks.find(
    (item) => item.eventKind === normalizedEvent.eventKind,
  );
  const sameTypeOutOfOrder = previousWatermark !== undefined
    && (normalizedEvent.exchangeEventTimeMs <= previousWatermark.exchangeEventTimeMs
      || (normalizedEvent.transactionTimeMs !== null && previousWatermark.transactionTimeMs !== null
        && normalizedEvent.transactionTimeMs <= previousWatermark.transactionTimeMs));
  const crossTypeOutOfOrder = state.lastExchangeEventTimeMs !== null
    && normalizedEvent.exchangeEventTimeMs < state.lastExchangeEventTimeMs;
  const supersededLeaseExpiry = normalizedEvent.eventKind === 'listenKeyExpired'
    && state.leaseObservedAtMs !== null
    && normalizedEvent.exchangeEventTimeMs <= state.leaseObservedAtMs;
  const coverageWillTruncate = state.recentEventRevisions.length
    >= USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS - 1;
  const recentEventRevisions = Object.freeze([
    ...state.recentEventRevisions,
    normalizedEvent.eventRevision,
  ].slice(-USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS));
  const eventMarker = normalizedEvent;
  const recentEventMarkers = Object.freeze([
    ...state.recentEventMarkers,
    eventMarker,
  ].slice(-USDM_PRIVATE_MAXIMUM_RECENT_EVENT_REVISIONS));

  if (sameTypeOutOfOrder || crossTypeOutOfOrder || supersededLeaseExpiry) {
    // An older listenKeyExpired event cannot revoke newer accepted lease truth.
    // It is retained only as bounded quality evidence and forces reconciliation.
    const outOfOrderEventCount = increment(state.outOfOrderEventCount);
    if (outOfOrderEventCount === null) return rejected(state, 'COUNTER_LIMIT_REACHED');
    const next = withEvaluation(state, actionTime, {
      observedEventCount,
      outOfOrderEventCount,
      recentEventMarkers,
      recentEventRevisions,
      dedupeCoverageTruncated: state.dedupeCoverageTruncated || coverageWillTruncate,
      lastContinuityBreakAtMs: actionTime,
      lastQualityLossAtMs: actionTime,
    });
    return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
  }

  const eventWatermarks = Object.freeze([
    ...state.eventWatermarks.filter((item) => item.eventKind !== normalizedEvent.eventKind),
    Object.freeze({
      eventKind: normalizedEvent.eventKind,
      exchangeEventTimeMs: normalizedEvent.exchangeEventTimeMs,
      transactionTimeMs: normalizedEvent.transactionTimeMs,
    }),
  ].sort((left, right) => left.eventKind < right.eventKind ? -1 : left.eventKind > right.eventKind ? 1 : 0));

  const expiredByEvent = normalizedEvent.eventKind === 'listenKeyExpired';
  const next = withEvaluation(state, actionTime, {
    observedEventCount,
    eventWatermarks,
    recentEventMarkers,
    recentEventRevisions,
    dedupeCoverageTruncated: state.dedupeCoverageTruncated || coverageWillTruncate,
    lastPrivateEventKind: normalizedEvent.eventKind,
    ...(semantics.semanticCategory === 'ACCOUNT' ? { lastAccountEvent: eventMarker } : {}),
    ...(semantics.semanticCategory === 'ORDER' ? { lastOrderEvent: eventMarker } : {}),
    ...(semantics.isFill ? { lastFillEvent: eventMarker } : {}),
    lastExchangeEventTimeMs: normalizedEvent.exchangeEventTimeMs,
    lastTransactionTimeMs: normalizedEvent.transactionTimeMs,
    lastReceiptTimeMs: actionTime,
    ...(expiredByEvent ? {
      leaseDisposition: 'EXPIRED_BY_EVENT' as const,
      leaseValidUntilMs: null,
      renewBeforeMs: null,
      authenticated: false,
      subscribed: false,
      lastContinuityBreakAtMs: actionTime,
    } : coverageWillTruncate ? {
      lastContinuityBreakAtMs: actionTime,
      lastQualityLossAtMs: actionTime,
    } : {}),
  });
  return next === null ? rejected(state, 'COUNTER_LIMIT_REACHED') : applied(next);
}
