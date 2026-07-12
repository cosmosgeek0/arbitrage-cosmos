import { types as utilTypes } from 'node:util';
import { createHash } from 'node:crypto';

import { privateAccountRealmReference } from './bounds.js';
import { L05_BINANCE_MATRIX_SHA256 } from './contracts.js';

const CONNECTION_LIFETIME_MS = 86_400_000 as const;
const MAXIMUM_ACTIVE_SUBSCRIPTIONS = 1_000;
const MAXIMUM_LIFETIME_SUBSCRIPTIONS = 65_535;
const MAXIMUM_DIAGNOSTIC_COUNTER = 1_000_000;
export const SPOT_PRIVATE_MAXIMUM_FUTURE_SKEW_MS = 2_000;
export const SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS = 64;
export const SPOT_OWNER_REST_MAXIMUM_FRESHNESS_MS = 300_000;
export const SPOT_PRIVATE_MATRIX_SHA256 = L05_BINANCE_MATRIX_SHA256;
export const SPOT_PRIVATE_DEFAULT_ACCOUNT_REALM_ID = 'account-realm-synthetic-a' as const;

export const SPOT_PRIVATE_EVENT_KINDS = Object.freeze([
  'ACCOUNT', 'ORDER', 'FILL',
] as const);

export type SpotPrivateEventKind = (typeof SPOT_PRIVATE_EVENT_KINDS)[number];
export type SpotRestReconciliationFreshness = 'UNAVAILABLE' | 'FRESH' | 'STALE' | 'LAGGING_STREAM';
export type SpotPrivateContinuityPosture =
  | 'UNPROVED'
  | 'RECONCILIATION_REQUIRED'
  | 'OWNER_CUT_COVERS_OBSERVED_EVENTS';

export interface SpotPrivateEventWatermark {
  readonly eventKind: SpotPrivateEventKind;
  readonly exchangeEventTimeMs: number;
}

export interface SpotPrivateEventMarker extends SpotPrivateEventWatermark {
  readonly accountRealmId: string;
  readonly generation: number;
  readonly eventRevision: string;
  readonly contentRevision: string;
  readonly receiptTimeMs: number;
}

export interface SpotOwnerRestReconciliationCut {
  readonly accountRealmId: string;
  readonly generation: number;
  readonly reconciliationRevision: string;
  readonly reconciledAtMs: number;
  readonly validUntilMs: number;
  readonly throughEventRevision: string | null;
  readonly throughExchangeEventTimeMs: number | null;
}

export const SPOT_SIGNATURE_LIFECYCLE_CONTRACT = Object.freeze({
  schema: 'SPOT_SIGNATURE_PRIVATE_STREAM_LIFECYCLE_V1',
  sourceRevision: 'L02-BINANCE-2026-07-12',
  matrixSha256: SPOT_PRIVATE_MATRIX_SHA256,
  product: 'SPOT',
  environment: 'PRODUCTION',
  realm: 'PRIVATE_USER_DATA',
  contractId: 'SPOT_WS_API_USER_DATA_SIGNATURE',
  routeClass: 'WEBSOCKET_API',
  subscriptionMethod: 'userDataStream.subscribe.signature',
  signatureKeyType: 'HMAC',
  encoding: 'JSON_TEXT',
  timestampUnit: 'MILLISECONDS',
  connectionLifetimeMs: CONNECTION_LIFETIME_MS,
  maximumActiveSubscriptions: MAXIMUM_ACTIVE_SUBSCRIPTIONS,
  maximumLifetimeSubscriptions: MAXIMUM_LIFETIME_SUBSCRIPTIONS,
  sessionAuthentication: 'NOT_USED_FOR_SIGNATURE_SUBSCRIPTION',
  documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
  externalActionAuthorization: 'NONE',
  actionAuthority: 'NONE_RECORD_ONLY',
} as const);

export type SpotSignatureLifecycleIntegrity = 'CLEAN' | 'DEGRADED';
export type SpotSignatureQualityPosture = 'CLEAN' | 'CURRENT_GENERATION_DEGRADED';

export type SpotSignatureLifecycleTransitionName =
  | 'INITIAL'
  | 'CONNECTION_OPENED'
  | 'SIGNATURE_SUBSCRIPTION_ACCEPTED'
  | 'SIGNATURE_SUBSCRIPTION_REJECTED'
  | 'TARGETED_UNSUBSCRIBE_ACCEPTED'
  | 'ALL_UNSUBSCRIBE_ACCEPTED'
  | 'EVENT_STREAM_TERMINATED'
  | 'SESSION_LOGOUT_OBSERVED_SIGNATURE_UNCHANGED'
  | 'SERVER_SHUTDOWN_OBSERVED'
  | 'CONNECTION_CLOSED'
  | 'CONNECTION_LIFETIME_EXPIRED'
  | 'CLOCK_OBSERVED'
  | 'EVENT_QUALITY_OBSERVED'
  | 'PRIVATE_EVENT_ACCEPTED'
  | 'PRIVATE_EVENT_DUPLICATE'
  | 'PRIVATE_EVENT_CONFLICT'
  | 'PRIVATE_EVENT_OUT_OF_ORDER'
  | 'STALE_GENERATION_EVENT_FENCED'
  | 'OWNER_REST_RECONCILIATION_OBSERVED'
  | 'OBSERVATION_REJECTED';

export type SpotSignatureDisconnectReason =
  | 'TRANSPORT_CLOSED'
  | 'PLANNED_RECONNECT'
  | 'CONNECTION_LIFETIME_EXPIRED'
  | 'SERVER_SHUTDOWN';

export interface SpotSignatureLifecycleState {
  readonly schema: 'SPOT_SIGNATURE_PRIVATE_STREAM_LIFECYCLE_V1';
  readonly sourceRevision: 'L02-BINANCE-2026-07-12';
  readonly matrixSha256: typeof SPOT_PRIVATE_MATRIX_SHA256;
  readonly accountRealmId: string;
  /** Canonical commitment over every normalized state field except itself. */
  readonly stateContentRevision: string;
  readonly product: 'SPOT';
  readonly environment: 'PRODUCTION';
  readonly realm: 'PRIVATE_USER_DATA';
  readonly contractId: 'SPOT_WS_API_USER_DATA_SIGNATURE';
  readonly routeClass: 'WEBSOCKET_API';
  readonly subscriptionMethod: 'userDataStream.subscribe.signature';
  readonly signatureKeyType: 'HMAC';
  readonly encoding: 'JSON_TEXT';
  readonly timestampUnit: 'MILLISECONDS';
  readonly connectionLifetimeMs: 86_400_000;
  readonly maximumActiveSubscriptions: 1_000;
  readonly maximumLifetimeSubscriptions: 65_535;
  readonly sessionAuthenticated: false;
  readonly connected: boolean;
  readonly signatureAuthorized: boolean;
  readonly subscribed: boolean;
  readonly generation: number | null;
  readonly connectedAtMs: number | null;
  readonly reconnectPlannedAtMs: number | null;
  readonly hardDisconnectAtMs: number | null;
  readonly reconnectDue: boolean;
  readonly lastObservedAtMs: number | null;
  readonly lastExchangeEventTimeMs: number | null;
  readonly subscriptionId: number | null;
  readonly pendingTerminationSubscriptionId: number | null;
  readonly sessionActiveSubscriptionCount: number;
  readonly sessionLifetimeSubscriptionCount: number;
  readonly integrityPosture: SpotSignatureLifecycleIntegrity;
  readonly qualityPosture: SpotSignatureQualityPosture;
  readonly lastQualityLossAtMs: number | null;
  readonly lastTransition: SpotSignatureLifecycleTransitionName;
  readonly lastDisconnectReason: SpotSignatureDisconnectReason | null;
  readonly connectionCount: number;
  readonly reconnectCount: number;
  readonly unsubscribeCount: number;
  readonly terminationCount: number;
  readonly logoutCount: number;
  readonly serverShutdownCount: number;
  readonly duplicateCount: number;
  readonly outOfOrderCount: number;
  readonly malformedCount: number;
  readonly staleGenerationEventCount: number;
  readonly conflictingEventCount: number;
  readonly observedPrivateEventCount: number;
  /** Current-generation observations not represented by a unique retained marker. */
  readonly unretainedPrivateEventObservationCount: number;
  /** Exact class-specific count of unretained duplicate private-event observations. */
  readonly privateEventDuplicateObservationCount: number;
  /** Exact class-specific count of unretained conflicting private-event observations. */
  readonly privateEventConflictObservationCount: number;
  readonly eventWatermarks: readonly Readonly<SpotPrivateEventWatermark>[];
  readonly recentEventMarkers: readonly Readonly<SpotPrivateEventMarker>[];
  readonly dedupeCoverageTruncated: boolean;
  readonly lastPrivateEventMarker: Readonly<SpotPrivateEventMarker> | null;
  readonly lastAccountEventMarker: Readonly<SpotPrivateEventMarker> | null;
  readonly lastOrderEventMarker: Readonly<SpotPrivateEventMarker> | null;
  readonly lastFillEventMarker: Readonly<SpotPrivateEventMarker> | null;
  readonly lastContinuityBreakAtMs: number | null;
  readonly ownerRestCut: Readonly<SpotOwnerRestReconciliationCut> | null;
  readonly restReconciliationFreshness: SpotRestReconciliationFreshness;
  readonly restReconciliationLagMs: number | null;
  readonly continuityPosture: SpotPrivateContinuityPosture;
  readonly sequenceCompleteness: 'UNKNOWN_NO_GLOBAL_SEQUENCE';
  readonly documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
  readonly truthAuthority: 'EVIDENCE_ONLY';
  readonly sendEligible: false;
  readonly accountReadAuthorized: false;
  readonly mutationAuthorized: false;
  readonly capitalAuthority: 'NONE';
  readonly riskAuthority: 'NONE';
  readonly reconciliationAuthority: 'NONE';
}

interface RealmBoundObservation {
  readonly accountRealmId: string;
}

interface ObservationBase extends RealmBoundObservation {
  readonly generation: number;
  readonly observedAtMs: number;
}

interface SessionCounters {
  readonly sessionActiveSubscriptionCount: number;
  readonly sessionLifetimeSubscriptionCount: number;
}

export type SpotSignatureLifecycleObservation =
  | (ObservationBase & SessionCounters & {
    readonly kind: 'CONNECTION_OPENED';
    readonly connectedAtMs: number;
    readonly reconnectPlannedAtMs: number;
  })
  | (ObservationBase & SessionCounters & {
    readonly kind: 'SIGNATURE_SUBSCRIPTION_ACCEPTED';
    readonly subscriptionId: number;
  })
  | (ObservationBase & SessionCounters & {
    readonly kind: 'SIGNATURE_SUBSCRIPTION_REJECTED';
  })
  | (ObservationBase & SessionCounters & {
    readonly kind: 'UNSUBSCRIBE_ACCEPTED';
    readonly scope: 'TARGETED' | 'ALL';
    readonly subscriptionId: number | null;
  })
  | (ObservationBase & SessionCounters & {
    readonly kind: 'EVENT_STREAM_TERMINATED';
    readonly subscriptionId: number | null;
    readonly exchangeEventTimeMs: number;
  })
  | (ObservationBase & SessionCounters & {
    readonly kind: 'SESSION_LOGOUT_OBSERVED';
  })
  | (ObservationBase & {
    readonly kind: 'SERVER_SHUTDOWN_OBSERVED';
    readonly exchangeEventTimeMs: number;
  })
  | (ObservationBase & {
    readonly kind: 'CONNECTION_CLOSED';
    readonly reason: 'TRANSPORT_CLOSED' | 'PLANNED_RECONNECT';
  })
  | (ObservationBase & {
    readonly kind: 'CLOCK_OBSERVED';
  })
  | (ObservationBase & {
    readonly kind: 'EVENT_QUALITY_OBSERVED';
    readonly quality: 'DUPLICATE' | 'OUT_OF_ORDER' | 'MALFORMED' | 'CONFLICT';
  })
  | (RealmBoundObservation & {
    readonly kind: 'PRIVATE_EVENT_OBSERVED';
    readonly generation: number;
    readonly eventKind: SpotPrivateEventKind;
    readonly eventRevision: string;
    readonly contentRevision: string;
    readonly exchangeEventTimeMs: number;
    readonly receiptTimeMs: number;
  })
  | (RealmBoundObservation & {
    readonly kind: 'OWNER_REST_RECONCILIATION_OBSERVED';
    readonly generation: number;
    readonly reconciliationRevision: string;
    readonly reconciledAtMs: number;
    readonly validUntilMs: number;
    readonly throughEventRevision: string | null;
    readonly throughExchangeEventTimeMs: number | null;
  });

export type SpotSignatureLifecycleIssueCode =
  | 'STATE_INVALID'
  | 'OBSERVATION_INVALID'
  | 'GENERATION_INVALID'
  | 'ACCOUNT_REALM_MISMATCH'
  | 'OBSERVATION_OUT_OF_ORDER'
  | 'CONNECTION_NOT_OPEN'
  | 'CONNECTION_ALREADY_OPEN'
  | 'RECONNECT_PLAN_INVALID'
  | 'SESSION_COUNTER_INVALID'
  | 'SESSION_COUNTER_CONFLICT'
  | 'ACTIVE_SUBSCRIPTION_LIMIT_REACHED'
  | 'LIFETIME_SUBSCRIPTION_LIMIT_REACHED'
  | 'ACCOUNT_ALREADY_SUBSCRIBED'
  | 'ACCOUNT_NOT_SUBSCRIBED'
  | 'SUBSCRIPTION_ID_UNATTRIBUTED'
  | 'TERMINATION_CONFIRMATION_PENDING'
  | 'CONNECTION_LIFETIME_EXPIRED'
  | 'EXCHANGE_EVENT_TIME_IN_FUTURE'
  | 'PRIVATE_EVENT_INVALID'
  | 'PRIVATE_EVENT_TIME_IN_FUTURE'
  | 'PRIVATE_EVENT_REQUIRES_SUBSCRIPTION'
  | 'COUNTER_LIMIT_REACHED'
  | 'REST_RECONCILIATION_CUT_INVALID';

export interface SpotSignatureLifecycleIssue {
  readonly code: SpotSignatureLifecycleIssueCode;
  readonly message: string;
}

export interface SpotSignatureLifecycleReduction {
  readonly schema: 'SPOT_SIGNATURE_PRIVATE_STREAM_REDUCTION_V1';
  readonly accepted: boolean;
  readonly issues: readonly SpotSignatureLifecycleIssue[];
  readonly state: Readonly<SpotSignatureLifecycleState>;
  readonly sendEligible: false;
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
}

type PlainRecord = Readonly<Record<string, unknown>>;
type DisconnectExtras = Readonly<Partial<Pick<
  SpotSignatureLifecycleState,
  'serverShutdownCount'
>>>;

const STATE_FIELDS = Object.freeze([
  'schema', 'sourceRevision', 'matrixSha256', 'accountRealmId',
  'stateContentRevision',
  'product', 'environment', 'realm', 'contractId',
  'routeClass', 'subscriptionMethod', 'signatureKeyType', 'encoding', 'timestampUnit',
  'connectionLifetimeMs', 'maximumActiveSubscriptions', 'maximumLifetimeSubscriptions',
  'sessionAuthenticated', 'connected', 'signatureAuthorized', 'subscribed', 'generation',
  'connectedAtMs', 'reconnectPlannedAtMs', 'hardDisconnectAtMs', 'reconnectDue',
  'lastObservedAtMs', 'lastExchangeEventTimeMs', 'subscriptionId',
  'pendingTerminationSubscriptionId',
  'sessionActiveSubscriptionCount', 'sessionLifetimeSubscriptionCount',
  'integrityPosture', 'qualityPosture', 'lastQualityLossAtMs',
  'lastTransition', 'lastDisconnectReason', 'connectionCount',
  'reconnectCount', 'unsubscribeCount', 'terminationCount', 'logoutCount',
  'serverShutdownCount', 'duplicateCount', 'outOfOrderCount', 'malformedCount',
  'staleGenerationEventCount', 'conflictingEventCount', 'observedPrivateEventCount',
  'unretainedPrivateEventObservationCount', 'privateEventDuplicateObservationCount',
  'privateEventConflictObservationCount',
  'eventWatermarks', 'recentEventMarkers', 'dedupeCoverageTruncated',
  'lastPrivateEventMarker', 'lastAccountEventMarker', 'lastOrderEventMarker',
  'lastFillEventMarker', 'lastContinuityBreakAtMs', 'ownerRestCut',
  'restReconciliationFreshness', 'restReconciliationLagMs', 'continuityPosture',
  'sequenceCompleteness',
  'documentaryAuthority', 'externalActionAuthorization', 'actionAuthority',
  'truthAuthority', 'sendEligible', 'accountReadAuthorized', 'mutationAuthorized',
  'capitalAuthority', 'riskAuthority', 'reconciliationAuthority',
] as const);

const OBSERVATION_FIELDS = Object.freeze({
  CONNECTION_OPENED: Object.freeze([
    'kind', 'accountRealmId', 'generation', 'observedAtMs', 'connectedAtMs', 'reconnectPlannedAtMs',
    'sessionActiveSubscriptionCount', 'sessionLifetimeSubscriptionCount',
  ]),
  SIGNATURE_SUBSCRIPTION_ACCEPTED: Object.freeze([
    'kind', 'accountRealmId', 'generation', 'observedAtMs', 'subscriptionId',
    'sessionActiveSubscriptionCount', 'sessionLifetimeSubscriptionCount',
  ]),
  SIGNATURE_SUBSCRIPTION_REJECTED: Object.freeze([
    'kind', 'accountRealmId', 'generation', 'observedAtMs',
    'sessionActiveSubscriptionCount', 'sessionLifetimeSubscriptionCount',
  ]),
  UNSUBSCRIBE_ACCEPTED: Object.freeze([
    'kind', 'accountRealmId', 'generation', 'observedAtMs', 'scope', 'subscriptionId',
    'sessionActiveSubscriptionCount', 'sessionLifetimeSubscriptionCount',
  ]),
  EVENT_STREAM_TERMINATED: Object.freeze([
    'kind', 'accountRealmId', 'generation', 'observedAtMs', 'subscriptionId', 'exchangeEventTimeMs',
    'sessionActiveSubscriptionCount', 'sessionLifetimeSubscriptionCount',
  ]),
  SESSION_LOGOUT_OBSERVED: Object.freeze([
    'kind', 'accountRealmId', 'generation', 'observedAtMs',
    'sessionActiveSubscriptionCount', 'sessionLifetimeSubscriptionCount',
  ]),
  SERVER_SHUTDOWN_OBSERVED: Object.freeze([
    'kind', 'accountRealmId', 'generation', 'observedAtMs', 'exchangeEventTimeMs',
  ]),
  CONNECTION_CLOSED: Object.freeze(['kind', 'accountRealmId', 'generation', 'observedAtMs', 'reason']),
  CLOCK_OBSERVED: Object.freeze(['kind', 'accountRealmId', 'generation', 'observedAtMs']),
  EVENT_QUALITY_OBSERVED: Object.freeze(['kind', 'accountRealmId', 'generation', 'observedAtMs', 'quality']),
  PRIVATE_EVENT_OBSERVED: Object.freeze([
    'kind', 'accountRealmId', 'generation', 'eventKind', 'eventRevision', 'contentRevision',
    'exchangeEventTimeMs', 'receiptTimeMs',
  ]),
  OWNER_REST_RECONCILIATION_OBSERVED: Object.freeze([
    'kind', 'accountRealmId', 'generation', 'reconciliationRevision', 'reconciledAtMs', 'validUntilMs',
    'throughEventRevision', 'throughExchangeEventTimeMs',
  ]),
} as const);

const LAST_TRANSITIONS = Object.freeze<readonly SpotSignatureLifecycleTransitionName[]>([
  'INITIAL', 'CONNECTION_OPENED', 'SIGNATURE_SUBSCRIPTION_ACCEPTED',
  'SIGNATURE_SUBSCRIPTION_REJECTED', 'TARGETED_UNSUBSCRIBE_ACCEPTED',
  'ALL_UNSUBSCRIBE_ACCEPTED', 'EVENT_STREAM_TERMINATED',
  'SESSION_LOGOUT_OBSERVED_SIGNATURE_UNCHANGED', 'SERVER_SHUTDOWN_OBSERVED',
  'CONNECTION_CLOSED', 'CONNECTION_LIFETIME_EXPIRED', 'CLOCK_OBSERVED',
  'EVENT_QUALITY_OBSERVED', 'PRIVATE_EVENT_ACCEPTED', 'PRIVATE_EVENT_DUPLICATE',
  'PRIVATE_EVENT_CONFLICT', 'PRIVATE_EVENT_OUT_OF_ORDER',
  'STALE_GENERATION_EVENT_FENCED', 'OWNER_REST_RECONCILIATION_OBSERVED',
  'OBSERVATION_REJECTED',
]);

const EVENT_REVISION_PATTERN = /^spot_event_[0-9a-f]{32}$/;
const CONTENT_REVISION_PATTERN = /^spot_content_[0-9a-f]{32}$/;
const REST_RECONCILIATION_REVISION_PATTERN = /^spot_rest_[0-9a-f]{32}$/;
const STATE_CONTENT_REVISION_PATTERN = /^spot_state_[0-9a-f]{64}$/;
const EVENT_WATERMARK_FIELDS = Object.freeze(['eventKind', 'exchangeEventTimeMs'] as const);
const EVENT_MARKER_FIELDS = Object.freeze([
  'accountRealmId', 'generation', 'eventKind', 'exchangeEventTimeMs', 'eventRevision',
  'contentRevision', 'receiptTimeMs',
] as const);
const OWNER_REST_CUT_FIELDS = Object.freeze([
  'accountRealmId', 'generation', 'reconciliationRevision', 'reconciledAtMs', 'validUntilMs',
  'throughEventRevision', 'throughExchangeEventTimeMs',
] as const);

const DISCONNECT_REASONS = Object.freeze<readonly SpotSignatureDisconnectReason[]>([
  'TRANSPORT_CLOSED', 'PLANNED_RECONNECT', 'CONNECTION_LIFETIME_EXPIRED',
  'SERVER_SHUTDOWN',
]);

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return nonNegativeInteger(value) && value > 0;
}

function optionalInteger(value: unknown): value is number | null {
  return value === null || nonNegativeInteger(value);
}

function incrementCounter(value: number): number {
  return Math.min(MAXIMUM_DIAGNOSTIC_COUNTER, value + 1);
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

function spotStateContentRevisionFor(
  state: Omit<SpotSignatureLifecycleState, 'stateContentRevision'>,
): string {
  const content = STATE_FIELDS
    .filter((field) => field !== 'stateContentRevision')
    .sort()
    .map((field) => [field, canonicalStateValue(state[field])]);
  return `spot_state_${createHash('sha256')
    .update(JSON.stringify(['L05_SPOT_PRIVATE_STATE_CONTENT_V1', content]))
    .digest('hex')}`;
}

function exactRecord(value: unknown, fields: readonly string[]): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || utilTypes.isProxy(value)) {
    throw new TypeError('lifecycle input must be a non-proxy plain record');
  }
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null)
    || keys.some((key) => typeof key !== 'string')
    || keys.length !== fields.length
    || keys.some((key) => !fields.includes(key as string))
    || Object.values(descriptors).some((descriptor) => !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value'))) {
    throw new TypeError('lifecycle input must use exact enumerable own data fields');
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) output[field] = descriptors[field]!.value;
  return output;
}

function observationRecord(value: unknown): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || utilTypes.isProxy(value)) {
    throw new TypeError('lifecycle observation must be a non-proxy plain record');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const kindDescriptor = descriptors.kind;
  if (kindDescriptor === undefined || !Object.hasOwn(kindDescriptor, 'value')
    || typeof kindDescriptor.value !== 'string'
    || !Object.hasOwn(OBSERVATION_FIELDS, kindDescriptor.value)) {
    throw new TypeError('lifecycle observation kind is invalid');
  }
  return exactRecord(value, OBSERVATION_FIELDS[
    kindDescriptor.value as keyof typeof OBSERVATION_FIELDS
  ]);
}

function sessionCounters(record: PlainRecord): { active: number; lifetime: number } {
  const active = record.sessionActiveSubscriptionCount;
  const lifetime = record.sessionLifetimeSubscriptionCount;
  if (!nonNegativeInteger(active) || active > MAXIMUM_ACTIVE_SUBSCRIPTIONS
    || !nonNegativeInteger(lifetime) || lifetime > MAXIMUM_LIFETIME_SUBSCRIPTIONS
    || active > lifetime) {
    throw new TypeError('Spot subscription counters are outside current limits');
  }
  return { active, lifetime };
}

function privateEventKind(value: unknown): value is SpotPrivateEventKind {
  return typeof value === 'string'
    && (SPOT_PRIVATE_EVENT_KINDS as readonly string[]).includes(value);
}

function spotContentRevision(
  domain: 'spot_event' | 'spot_rest',
  accountRealmId: string,
  content: readonly unknown[],
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([
      'L05_SPOT_PRIVATE_CONTENT_REVISION_V2', domain, accountRealmId, ...content,
    ]))
    .digest('hex')
    .slice(0, 32);
  return `${domain}_${digest}`;
}

function spotEventRevisionFor(input: Readonly<{
  accountRealmId: string;
  generation: number;
  eventKind: SpotPrivateEventKind;
  contentRevision: string;
  exchangeEventTimeMs: number;
  receiptTimeMs: number;
}>): string {
  return spotContentRevision('spot_event', input.accountRealmId, [
    input.generation,
    input.eventKind,
    input.contentRevision,
    input.exchangeEventTimeMs,
    input.receiptTimeMs,
  ]);
}

function spotRestRevisionFor(input: Readonly<{
  accountRealmId: string;
  generation: number;
  reconciledAtMs: number;
  validUntilMs: number;
  throughEventRevision: string | null;
  throughExchangeEventTimeMs: number | null;
}>): string {
  return spotContentRevision('spot_rest', input.accountRealmId, [
    input.generation,
    input.reconciledAtMs,
    input.validUntilMs,
    input.throughEventRevision,
    input.throughExchangeEventTimeMs,
  ]);
}

/** Builds the canonical content-derived revision used by injected Spot evidence. */
export function createSpotRealmBoundRevision(
  domain: 'spot_event' | 'spot_rest',
  accountRealmValue: unknown,
  contentValue: unknown,
): string {
  const accountRealmId = privateAccountRealmReference(
    accountRealmValue,
    'Spot revision accountRealmId',
  );
  if (domain === 'spot_event') {
    const content = exactRecord(contentValue, [
      'generation', 'eventKind', 'contentRevision', 'exchangeEventTimeMs', 'receiptTimeMs',
    ]);
    if (!positiveInteger(content.generation) || !privateEventKind(content.eventKind)
      || typeof content.contentRevision !== 'string'
      || !CONTENT_REVISION_PATTERN.test(content.contentRevision)
      || !nonNegativeInteger(content.exchangeEventTimeMs)
      || !nonNegativeInteger(content.receiptTimeMs)) {
      throw new TypeError('Spot event revision content is invalid');
    }
    return spotEventRevisionFor({
      accountRealmId,
      generation: content.generation,
      eventKind: content.eventKind,
      contentRevision: content.contentRevision,
      exchangeEventTimeMs: content.exchangeEventTimeMs,
      receiptTimeMs: content.receiptTimeMs,
    });
  }
  const content = exactRecord(contentValue, [
    'generation', 'reconciledAtMs', 'validUntilMs',
    'throughEventRevision', 'throughExchangeEventTimeMs',
  ]);
  if (!positiveInteger(content.generation)
    || !nonNegativeInteger(content.reconciledAtMs)
    || !nonNegativeInteger(content.validUntilMs)
    || (content.throughEventRevision !== null
      && (typeof content.throughEventRevision !== 'string'
        || !EVENT_REVISION_PATTERN.test(content.throughEventRevision)))
    || !optionalInteger(content.throughExchangeEventTimeMs)
    || ((content.throughEventRevision === null)
      !== (content.throughExchangeEventTimeMs === null))) {
    throw new TypeError('Spot REST revision content is invalid');
  }
  return spotRestRevisionFor({
    accountRealmId,
    generation: content.generation,
    reconciledAtMs: content.reconciledAtMs,
    validUntilMs: content.validUntilMs,
    throughEventRevision: content.throughEventRevision as string | null,
    throughExchangeEventTimeMs: content.throughExchangeEventTimeMs as number | null,
  });
}

function denseArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    throw new TypeError('lifecycle retained evidence must be a bounded dense array');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string') || keys.length !== value.length + 1) {
    throw new TypeError('lifecycle retained evidence array shape is invalid');
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('lifecycle retained evidence array must be dense data');
    }
    output.push(descriptor.value);
  }
  return output;
}

function eventMarker(value: unknown): Readonly<SpotPrivateEventMarker> {
  const record = exactRecord(value, EVENT_MARKER_FIELDS);
  const accountRealmId = privateAccountRealmReference(
    record.accountRealmId,
    'Spot private event marker accountRealmId',
  );
  if (record.accountRealmId !== accountRealmId
    || !positiveInteger(record.generation)
    || !privateEventKind(record.eventKind)
    || !nonNegativeInteger(record.exchangeEventTimeMs)
    || !nonNegativeInteger(record.receiptTimeMs)
    || typeof record.eventRevision !== 'string'
    || !EVENT_REVISION_PATTERN.test(record.eventRevision)
    || typeof record.contentRevision !== 'string'
    || !CONTENT_REVISION_PATTERN.test(record.contentRevision)) {
    throw new TypeError('Spot private event marker is invalid');
  }
  const marker = Object.freeze({
    accountRealmId,
    generation: record.generation,
    eventKind: record.eventKind,
    exchangeEventTimeMs: record.exchangeEventTimeMs,
    eventRevision: record.eventRevision,
    contentRevision: record.contentRevision,
    receiptTimeMs: record.receiptTimeMs,
  });
  if (marker.eventRevision !== spotEventRevisionFor(marker)) {
    throw new TypeError('Spot private event revision does not bind marker content');
  }
  return marker;
}

function eventMarkerOrNull(value: unknown): Readonly<SpotPrivateEventMarker> | null {
  return value === null ? null : eventMarker(value);
}

function eventMarkers(value: unknown): readonly Readonly<SpotPrivateEventMarker>[] {
  const rows = denseArray(value, SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS);
  const output = rows.map(eventMarker);
  if (new Set(output.map((marker) => marker.eventRevision)).size !== output.length) {
    throw new TypeError('Spot retained event revisions must be unique');
  }
  return Object.freeze(output);
}

function eventWatermarks(value: unknown): readonly Readonly<SpotPrivateEventWatermark>[] {
  const rows = denseArray(value, SPOT_PRIVATE_EVENT_KINDS.length);
  const kinds = new Set<string>();
  const output = rows.map((row) => {
    const record = exactRecord(row, EVENT_WATERMARK_FIELDS);
    if (!privateEventKind(record.eventKind) || !nonNegativeInteger(record.exchangeEventTimeMs)
      || kinds.has(record.eventKind)) throw new TypeError('Spot event watermark is invalid');
    kinds.add(record.eventKind);
    return Object.freeze({
      eventKind: record.eventKind,
      exchangeEventTimeMs: record.exchangeEventTimeMs,
    });
  }).sort((left, right) => left.eventKind < right.eventKind ? -1 : left.eventKind > right.eventKind ? 1 : 0);
  return Object.freeze(output);
}

function ownerRestCut(value: unknown): Readonly<SpotOwnerRestReconciliationCut> | null {
  if (value === null) return null;
  const record = exactRecord(value, OWNER_REST_CUT_FIELDS);
  const accountRealmId = privateAccountRealmReference(
    record.accountRealmId,
    'Spot owner REST cut accountRealmId',
  );
  if (record.accountRealmId !== accountRealmId
    || !positiveInteger(record.generation)
    || typeof record.reconciliationRevision !== 'string'
    || !REST_RECONCILIATION_REVISION_PATTERN.test(record.reconciliationRevision)
    || !nonNegativeInteger(record.reconciledAtMs)
    || !nonNegativeInteger(record.validUntilMs)
    || record.validUntilMs < record.reconciledAtMs
    || record.validUntilMs - record.reconciledAtMs
      > SPOT_OWNER_REST_MAXIMUM_FRESHNESS_MS
    || (record.throughEventRevision !== null
      && (typeof record.throughEventRevision !== 'string'
        || !EVENT_REVISION_PATTERN.test(record.throughEventRevision)))
    || !optionalInteger(record.throughExchangeEventTimeMs)
    || ((record.throughEventRevision === null) !== (record.throughExchangeEventTimeMs === null))) {
    throw new TypeError('Spot owner REST reconciliation cut is invalid');
  }
  const cut = Object.freeze({
    accountRealmId,
    generation: record.generation,
    reconciliationRevision: record.reconciliationRevision,
    reconciledAtMs: record.reconciledAtMs,
    validUntilMs: record.validUntilMs,
    throughEventRevision: record.throughEventRevision as string | null,
    throughExchangeEventTimeMs: record.throughExchangeEventTimeMs as number | null,
  });
  if (cut.reconciliationRevision !== spotRestRevisionFor(cut)) {
    throw new TypeError('Spot owner REST revision does not bind cut content');
  }
  return cut;
}

function markerFromObservation(record: PlainRecord): Readonly<SpotPrivateEventMarker> {
  return eventMarker({
    accountRealmId: record.accountRealmId,
    generation: record.generation,
    eventKind: record.eventKind,
    exchangeEventTimeMs: record.exchangeEventTimeMs,
    eventRevision: record.eventRevision,
    contentRevision: record.contentRevision,
    receiptTimeMs: record.receiptTimeMs,
  });
}

function sameEventIdentity(
  marker: Readonly<SpotPrivateEventMarker>,
  candidate: Readonly<SpotPrivateEventMarker>,
): boolean {
  return marker.accountRealmId === candidate.accountRealmId
    && marker.generation === candidate.generation
    && marker.eventKind === candidate.eventKind
    && marker.eventRevision === candidate.eventRevision
    && marker.contentRevision === candidate.contentRevision
    && marker.exchangeEventTimeMs === candidate.exchangeEventTimeMs
    && marker.receiptTimeMs === candidate.receiptTimeMs;
}

function sameEventBaseIdentity(
  marker: Readonly<SpotPrivateEventMarker>,
  candidate: Readonly<SpotPrivateEventMarker>,
): boolean {
  return marker.accountRealmId === candidate.accountRealmId
    && marker.generation === candidate.generation
    && marker.eventKind === candidate.eventKind
    && marker.exchangeEventTimeMs === candidate.exchangeEventTimeMs
    && marker.receiptTimeMs === candidate.receiptTimeMs;
}

function sameMarker(
  left: Readonly<SpotPrivateEventMarker> | null,
  right: Readonly<SpotPrivateEventMarker> | null,
): boolean {
  return left === null || right === null
    ? left === right
    : left.accountRealmId === right.accountRealmId
      && left.generation === right.generation
      && left.eventKind === right.eventKind
      && left.eventRevision === right.eventRevision
      && left.contentRevision === right.contentRevision
      && left.exchangeEventTimeMs === right.exchangeEventTimeMs
      && left.receiptTimeMs === right.receiptTimeMs;
}

interface ReplayedSpotPrivateMarkers {
  readonly eventWatermarks: readonly Readonly<SpotPrivateEventWatermark>[];
  readonly lastPrivateEventMarker: Readonly<SpotPrivateEventMarker> | null;
  readonly lastAccountEventMarker: Readonly<SpotPrivateEventMarker> | null;
  readonly lastOrderEventMarker: Readonly<SpotPrivateEventMarker> | null;
  readonly lastFillEventMarker: Readonly<SpotPrivateEventMarker> | null;
}

function replaySpotPrivateMarkers(
  markers: readonly Readonly<SpotPrivateEventMarker>[],
): ReplayedSpotPrivateMarkers {
  let eventWatermarks: Readonly<SpotPrivateEventWatermark>[] = [];
  let lastPrivateEventMarker: Readonly<SpotPrivateEventMarker> | null = null;
  let lastAccountEventMarker: Readonly<SpotPrivateEventMarker> | null = null;
  let lastOrderEventMarker: Readonly<SpotPrivateEventMarker> | null = null;
  let lastFillEventMarker: Readonly<SpotPrivateEventMarker> | null = null;
  for (const marker of markers) {
    const priorWatermark = eventWatermarks.find(
      (watermark) => watermark.eventKind === marker.eventKind,
    );
    if (priorWatermark !== undefined
      && marker.exchangeEventTimeMs <= priorWatermark.exchangeEventTimeMs) continue;
    eventWatermarks = [
      ...eventWatermarks.filter((watermark) => watermark.eventKind !== marker.eventKind),
      Object.freeze({
        eventKind: marker.eventKind,
        exchangeEventTimeMs: marker.exchangeEventTimeMs,
      }),
    ].sort((left, right) => (
      left.eventKind < right.eventKind ? -1 : left.eventKind > right.eventKind ? 1 : 0
    ));
    lastPrivateEventMarker = marker;
    if (marker.eventKind === 'ACCOUNT') lastAccountEventMarker = marker;
    if (marker.eventKind === 'ORDER') lastOrderEventMarker = marker;
    if (marker.eventKind === 'FILL') lastFillEventMarker = marker;
  }
  return Object.freeze({
    eventWatermarks: Object.freeze(eventWatermarks),
    lastPrivateEventMarker,
    lastAccountEventMarker,
    lastOrderEventMarker,
    lastFillEventMarker,
  });
}

function sameWatermarks(
  left: readonly Readonly<SpotPrivateEventWatermark>[],
  right: readonly Readonly<SpotPrivateEventWatermark>[],
): boolean {
  return left.length === right.length && left.every((watermark, index) => {
    const expected = right[index];
    return expected !== undefined && watermark.eventKind === expected.eventKind
      && watermark.exchangeEventTimeMs === expected.exchangeEventTimeMs;
  });
}

function integrityDerived(
  state: Pick<SpotSignatureLifecycleState,
    | 'dedupeCoverageTruncated' | 'duplicateCount' | 'outOfOrderCount' | 'malformedCount'
    | 'staleGenerationEventCount' | 'conflictingEventCount'
    | 'lastQualityLossAtMs' | 'lastContinuityBreakAtMs' | 'ownerRestCut'>,
): SpotSignatureLifecycleIntegrity {
  const irreversibleQualityLoss = state.lastQualityLossAtMs !== null
    || state.dedupeCoverageTruncated
    || state.duplicateCount > 0
    || state.outOfOrderCount > 0
    || state.malformedCount > 0
    || state.staleGenerationEventCount > 0
    || state.conflictingEventCount > 0;
  const uncoveredContinuityBreak = state.lastContinuityBreakAtMs !== null
    && (state.ownerRestCut === null
      || state.ownerRestCut.reconciledAtMs < state.lastContinuityBreakAtMs);
  return irreversibleQualityLoss || uncoveredContinuityBreak ? 'DEGRADED' : 'CLEAN';
}

function reconciliationDerived(state: SpotSignatureLifecycleState): Readonly<{
  freshness: SpotRestReconciliationFreshness;
  lagMs: number | null;
  continuity: SpotPrivateContinuityPosture;
}> {
  const cut = state.ownerRestCut;
  const last = state.lastPrivateEventMarker;
  const evaluatedAtMs = state.lastObservedAtMs ?? 0;
  let freshness: SpotRestReconciliationFreshness;
  if (cut === null || state.generation === null || cut.generation !== state.generation) {
    freshness = 'UNAVAILABLE';
  } else if (evaluatedAtMs > cut.validUntilMs) {
    freshness = 'STALE';
  } else if (last === null) {
    freshness = cut.throughEventRevision === null ? 'FRESH' : 'LAGGING_STREAM';
  } else {
    freshness = cut.throughEventRevision === last.eventRevision
      && cut.throughExchangeEventTimeMs === last.exchangeEventTimeMs
      ? 'FRESH'
      : 'LAGGING_STREAM';
  }
  const lagMs = freshness === 'LAGGING_STREAM' && last !== null
    && cut?.throughExchangeEventTimeMs !== null
    && cut?.throughExchangeEventTimeMs !== undefined
    ? Math.max(0, last.exchangeEventTimeMs - cut.throughExchangeEventTimeMs)
    : null;
  const covered = freshness === 'FRESH' && cut !== null;
  const continuity: SpotPrivateContinuityPosture = covered
    && (state.lastContinuityBreakAtMs === null
      || cut.reconciledAtMs >= state.lastContinuityBreakAtMs)
    ? 'OWNER_CUT_COVERS_OBSERVED_EVENTS'
    : state.generation !== null || state.lastContinuityBreakAtMs !== null
      ? 'RECONCILIATION_REQUIRED'
      : 'UNPROVED';
  return Object.freeze({ freshness, lagMs, continuity });
}

type SpotStateCandidate = Omit<SpotSignatureLifecycleState, 'stateContentRevision'>
  & Partial<Pick<SpotSignatureLifecycleState, 'stateContentRevision'>>;

function freezeState(state: SpotStateCandidate): Readonly<SpotSignatureLifecycleState> {
  const derived = reconciliationDerived(state as SpotSignatureLifecycleState);
  const markers = eventMarkers(state.recentEventMarkers);
  const watermarks = eventWatermarks(state.eventWatermarks);
  const freezeOptionalMarker = (marker: Readonly<SpotPrivateEventMarker> | null) => (
    marker === null ? null : eventMarker(marker)
  );
  const { stateContentRevision: _discardedRevision, ...stateWithoutRevision } = state;
  const normalized = {
    ...stateWithoutRevision,
    reconnectDue: state.generation === null
      ? false
      : state.connected
        ? (state.lastObservedAtMs as number) >= (state.reconnectPlannedAtMs as number)
        : true,
    integrityPosture: integrityDerived(state),
    qualityPosture: state.lastQualityLossAtMs === null
      ? 'CLEAN'
      : 'CURRENT_GENERATION_DEGRADED',
    lastExchangeEventTimeMs: state.lastPrivateEventMarker?.exchangeEventTimeMs ?? null,
    eventWatermarks: watermarks,
    recentEventMarkers: markers,
    lastPrivateEventMarker: freezeOptionalMarker(state.lastPrivateEventMarker),
    lastAccountEventMarker: freezeOptionalMarker(state.lastAccountEventMarker),
    lastOrderEventMarker: freezeOptionalMarker(state.lastOrderEventMarker),
    lastFillEventMarker: freezeOptionalMarker(state.lastFillEventMarker),
    ownerRestCut: state.ownerRestCut === null ? null : ownerRestCut(state.ownerRestCut),
    restReconciliationFreshness: derived.freshness,
    restReconciliationLagMs: derived.lagMs,
    continuityPosture: derived.continuity,
  } as Omit<SpotSignatureLifecycleState, 'stateContentRevision'>;
  return Object.freeze({
    ...normalized,
    stateContentRevision: spotStateContentRevisionFor(normalized),
  });
}

function initialState(
  accountRealmValue: unknown = SPOT_PRIVATE_DEFAULT_ACCOUNT_REALM_ID,
): Readonly<SpotSignatureLifecycleState> {
  const accountRealmId = privateAccountRealmReference(
    accountRealmValue,
    'Spot lifecycle accountRealmId',
  );
  return freezeState({
    schema: SPOT_SIGNATURE_LIFECYCLE_CONTRACT.schema,
    sourceRevision: SPOT_SIGNATURE_LIFECYCLE_CONTRACT.sourceRevision,
    matrixSha256: SPOT_PRIVATE_MATRIX_SHA256,
    accountRealmId,
    product: SPOT_SIGNATURE_LIFECYCLE_CONTRACT.product,
    environment: SPOT_SIGNATURE_LIFECYCLE_CONTRACT.environment,
    realm: SPOT_SIGNATURE_LIFECYCLE_CONTRACT.realm,
    contractId: SPOT_SIGNATURE_LIFECYCLE_CONTRACT.contractId,
    routeClass: SPOT_SIGNATURE_LIFECYCLE_CONTRACT.routeClass,
    subscriptionMethod: SPOT_SIGNATURE_LIFECYCLE_CONTRACT.subscriptionMethod,
    signatureKeyType: SPOT_SIGNATURE_LIFECYCLE_CONTRACT.signatureKeyType,
    encoding: SPOT_SIGNATURE_LIFECYCLE_CONTRACT.encoding,
    timestampUnit: SPOT_SIGNATURE_LIFECYCLE_CONTRACT.timestampUnit,
    connectionLifetimeMs: CONNECTION_LIFETIME_MS,
    maximumActiveSubscriptions: MAXIMUM_ACTIVE_SUBSCRIPTIONS,
    maximumLifetimeSubscriptions: MAXIMUM_LIFETIME_SUBSCRIPTIONS,
    sessionAuthenticated: false,
    connected: false,
    signatureAuthorized: false,
    subscribed: false,
    generation: null,
    connectedAtMs: null,
    reconnectPlannedAtMs: null,
    hardDisconnectAtMs: null,
    reconnectDue: false,
    lastObservedAtMs: null,
    lastExchangeEventTimeMs: null,
    subscriptionId: null,
    pendingTerminationSubscriptionId: null,
    sessionActiveSubscriptionCount: 0,
    sessionLifetimeSubscriptionCount: 0,
    integrityPosture: 'CLEAN',
    qualityPosture: 'CLEAN',
    lastQualityLossAtMs: null,
    lastTransition: 'INITIAL',
    lastDisconnectReason: null,
    connectionCount: 0,
    reconnectCount: 0,
    unsubscribeCount: 0,
    terminationCount: 0,
    logoutCount: 0,
    serverShutdownCount: 0,
    duplicateCount: 0,
    outOfOrderCount: 0,
    malformedCount: 0,
    staleGenerationEventCount: 0,
    conflictingEventCount: 0,
    observedPrivateEventCount: 0,
    unretainedPrivateEventObservationCount: 0,
    privateEventDuplicateObservationCount: 0,
    privateEventConflictObservationCount: 0,
    eventWatermarks: Object.freeze([]),
    recentEventMarkers: Object.freeze([]),
    dedupeCoverageTruncated: false,
    lastPrivateEventMarker: null,
    lastAccountEventMarker: null,
    lastOrderEventMarker: null,
    lastFillEventMarker: null,
    lastContinuityBreakAtMs: null,
    ownerRestCut: null,
    restReconciliationFreshness: 'UNAVAILABLE',
    restReconciliationLagMs: null,
    continuityPosture: 'UNPROVED',
    sequenceCompleteness: 'UNKNOWN_NO_GLOBAL_SEQUENCE',
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
    externalActionAuthorization: 'NONE',
    actionAuthority: 'NONE_RECORD_ONLY',
    truthAuthority: 'EVIDENCE_ONLY',
    sendEligible: false,
    accountReadAuthorized: false,
    mutationAuthorized: false,
    capitalAuthority: 'NONE',
    riskAuthority: 'NONE',
    reconciliationAuthority: 'NONE',
  });
}

export function createSpotSignatureLifecycleState(
  accountRealmId: unknown = SPOT_PRIVATE_DEFAULT_ACCOUNT_REALM_ID,
): Readonly<SpotSignatureLifecycleState> {
  return initialState(accountRealmId);
}

export function createInitialSpotPrivateLifecycleState(
  accountRealmId: unknown = SPOT_PRIVATE_DEFAULT_ACCOUNT_REALM_ID,
): Readonly<SpotSignatureLifecycleState> {
  return createSpotSignatureLifecycleState(accountRealmId);
}

function validState(value: unknown): Readonly<SpotSignatureLifecycleState> | null {
  try {
    const state = exactRecord(value, STATE_FIELDS);
    const accountRealmId = privateAccountRealmReference(
      state.accountRealmId,
      'Spot lifecycle state accountRealmId',
    );
    const watermarks = eventWatermarks(state.eventWatermarks);
    const markers = eventMarkers(state.recentEventMarkers);
    const lastPrivate = eventMarkerOrNull(state.lastPrivateEventMarker);
    const lastAccount = eventMarkerOrNull(state.lastAccountEventMarker);
    const lastOrder = eventMarkerOrNull(state.lastOrderEventMarker);
    const lastFill = eventMarkerOrNull(state.lastFillEventMarker);
    const cut = ownerRestCut(state.ownerRestCut);
    if (state.schema !== SPOT_SIGNATURE_LIFECYCLE_CONTRACT.schema
      || state.sourceRevision !== SPOT_SIGNATURE_LIFECYCLE_CONTRACT.sourceRevision
      || state.matrixSha256 !== SPOT_PRIVATE_MATRIX_SHA256
      || state.accountRealmId !== accountRealmId
      || typeof state.stateContentRevision !== 'string'
      || !STATE_CONTENT_REVISION_PATTERN.test(state.stateContentRevision)
      || state.product !== 'SPOT'
      || state.environment !== 'PRODUCTION'
      || state.realm !== 'PRIVATE_USER_DATA'
      || state.contractId !== 'SPOT_WS_API_USER_DATA_SIGNATURE'
      || state.routeClass !== 'WEBSOCKET_API'
      || state.subscriptionMethod !== 'userDataStream.subscribe.signature'
      || state.signatureKeyType !== 'HMAC'
      || state.encoding !== 'JSON_TEXT'
      || state.timestampUnit !== 'MILLISECONDS'
      || state.connectionLifetimeMs !== CONNECTION_LIFETIME_MS
      || state.maximumActiveSubscriptions !== MAXIMUM_ACTIVE_SUBSCRIPTIONS
      || state.maximumLifetimeSubscriptions !== MAXIMUM_LIFETIME_SUBSCRIPTIONS
      || state.sessionAuthenticated !== false
      || typeof state.connected !== 'boolean'
      || typeof state.signatureAuthorized !== 'boolean'
      || typeof state.subscribed !== 'boolean'
      || !optionalInteger(state.generation)
      || !optionalInteger(state.connectedAtMs)
      || !optionalInteger(state.reconnectPlannedAtMs)
      || !optionalInteger(state.hardDisconnectAtMs)
      || typeof state.reconnectDue !== 'boolean'
      || !optionalInteger(state.lastObservedAtMs)
      || !optionalInteger(state.lastExchangeEventTimeMs)
      || !optionalInteger(state.subscriptionId)
      || !optionalInteger(state.pendingTerminationSubscriptionId)
      || !nonNegativeInteger(state.sessionActiveSubscriptionCount)
      || state.sessionActiveSubscriptionCount > MAXIMUM_ACTIVE_SUBSCRIPTIONS
      || !nonNegativeInteger(state.sessionLifetimeSubscriptionCount)
      || state.sessionLifetimeSubscriptionCount > MAXIMUM_LIFETIME_SUBSCRIPTIONS
      || state.sessionActiveSubscriptionCount > state.sessionLifetimeSubscriptionCount
      || (state.integrityPosture !== 'CLEAN' && state.integrityPosture !== 'DEGRADED')
      || (state.qualityPosture !== 'CLEAN'
        && state.qualityPosture !== 'CURRENT_GENERATION_DEGRADED')
      || !optionalInteger(state.lastQualityLossAtMs)
      || typeof state.lastTransition !== 'string'
      || !LAST_TRANSITIONS.includes(state.lastTransition as SpotSignatureLifecycleTransitionName)
      || (state.lastDisconnectReason !== null
        && (typeof state.lastDisconnectReason !== 'string'
          || !DISCONNECT_REASONS.includes(state.lastDisconnectReason as SpotSignatureDisconnectReason)))
      || !nonNegativeInteger(state.connectionCount)
      || !nonNegativeInteger(state.reconnectCount)
      || !nonNegativeInteger(state.unsubscribeCount)
      || !nonNegativeInteger(state.terminationCount)
      || !nonNegativeInteger(state.logoutCount)
      || !nonNegativeInteger(state.serverShutdownCount)
      || !nonNegativeInteger(state.duplicateCount)
      || !nonNegativeInteger(state.outOfOrderCount)
      || !nonNegativeInteger(state.malformedCount)
      || !nonNegativeInteger(state.staleGenerationEventCount)
      || !nonNegativeInteger(state.conflictingEventCount)
      || !nonNegativeInteger(state.observedPrivateEventCount)
      || !nonNegativeInteger(state.unretainedPrivateEventObservationCount)
      || !nonNegativeInteger(state.privateEventDuplicateObservationCount)
      || !nonNegativeInteger(state.privateEventConflictObservationCount)
      || typeof state.dedupeCoverageTruncated !== 'boolean'
      || !optionalInteger(state.lastContinuityBreakAtMs)
      || (state.restReconciliationFreshness !== 'UNAVAILABLE'
        && state.restReconciliationFreshness !== 'FRESH'
        && state.restReconciliationFreshness !== 'STALE'
        && state.restReconciliationFreshness !== 'LAGGING_STREAM')
      || !optionalInteger(state.restReconciliationLagMs)
      || (state.continuityPosture !== 'UNPROVED'
        && state.continuityPosture !== 'RECONCILIATION_REQUIRED'
        && state.continuityPosture !== 'OWNER_CUT_COVERS_OBSERVED_EVENTS')
      || state.sequenceCompleteness !== 'UNKNOWN_NO_GLOBAL_SEQUENCE'
      || state.documentaryAuthority !== 'DOCUMENTARY_EVIDENCE_ONLY'
      || state.externalActionAuthorization !== 'NONE'
      || state.actionAuthority !== 'NONE_RECORD_ONLY'
      || state.truthAuthority !== 'EVIDENCE_ONLY'
      || state.sendEligible !== false
      || state.accountReadAuthorized !== false
      || state.mutationAuthorized !== false
      || state.capitalAuthority !== 'NONE'
      || state.riskAuthority !== 'NONE'
      || state.reconciliationAuthority !== 'NONE') return null;

    if ([
      state.connectionCount, state.reconnectCount, state.unsubscribeCount,
      state.terminationCount, state.logoutCount, state.serverShutdownCount,
      state.duplicateCount, state.outOfOrderCount, state.malformedCount,
      state.staleGenerationEventCount, state.conflictingEventCount,
      state.observedPrivateEventCount, state.unretainedPrivateEventObservationCount,
      state.privateEventDuplicateObservationCount,
      state.privateEventConflictObservationCount,
    ].some((counter) => counter > MAXIMUM_DIAGNOSTIC_COUNTER)) return null;

    if (state.generation === null) {
      if (state.connected || state.signatureAuthorized || state.subscribed
        || state.connectedAtMs !== null || state.reconnectPlannedAtMs !== null
        || state.hardDisconnectAtMs !== null || state.subscriptionId !== null
        || state.pendingTerminationSubscriptionId !== null
        || state.connectionCount !== 0 || state.reconnectCount !== 0
        || markers.length !== 0 || watermarks.length !== 0 || lastPrivate !== null
        || lastAccount !== null || lastOrder !== null || lastFill !== null
        || state.lastContinuityBreakAtMs !== null || cut !== null
        || state.dedupeCoverageTruncated !== false
        || state.observedPrivateEventCount !== 0
        || state.unretainedPrivateEventObservationCount !== 0
        || state.privateEventDuplicateObservationCount !== 0
        || state.privateEventConflictObservationCount !== 0) return null;
    } else if (!positiveInteger(state.generation)
      || state.connectedAtMs === null
      || state.reconnectPlannedAtMs === null
      || state.hardDisconnectAtMs === null
      || state.lastObservedAtMs === null
      || state.lastObservedAtMs < state.connectedAtMs
      || state.hardDisconnectAtMs !== state.connectedAtMs + CONNECTION_LIFETIME_MS
      || state.reconnectPlannedAtMs < state.connectedAtMs
      || state.reconnectPlannedAtMs >= state.hardDisconnectAtMs
      || state.connectionCount < 1
      || state.reconnectCount >= state.connectionCount) return null;

    if (!state.connected && (state.signatureAuthorized || state.subscribed
      || state.subscriptionId !== null || state.pendingTerminationSubscriptionId !== null
      || state.sessionActiveSubscriptionCount !== 0)) return null;
    if (state.connected && state.hardDisconnectAtMs !== null
      && state.lastObservedAtMs !== null
      && state.lastObservedAtMs >= state.hardDisconnectAtMs) return null;
    if (state.signatureAuthorized && !state.connected) return null;
    if (state.subscribed && (!state.connected || !state.signatureAuthorized
      || state.subscriptionId === null || state.sessionActiveSubscriptionCount < 1)) return null;
    if (!state.subscribed && state.subscriptionId !== null) return null;
    if (state.pendingTerminationSubscriptionId !== null && state.subscribed) return null;
    const categoryMarkers = new Map<SpotPrivateEventKind, Readonly<SpotPrivateEventMarker> | null>([
      ['ACCOUNT', lastAccount], ['ORDER', lastOrder], ['FILL', lastFill],
    ]);
    const lastObservedAtMs = state.lastObservedAtMs as number | null;
    const markerWithinFutureSkew = (marker: Readonly<SpotPrivateEventMarker>) => (
      marker.exchangeEventTimeMs <= marker.receiptTimeMs
      || marker.exchangeEventTimeMs - marker.receiptTimeMs
        <= SPOT_PRIVATE_MAXIMUM_FUTURE_SKEW_MS
    );
    const nonNullCategoryMarkers = [lastAccount, lastOrder, lastFill].filter(
      (marker): marker is Readonly<SpotPrivateEventMarker> => marker !== null,
    );
    if ((lastAccount !== null && lastAccount.eventKind !== 'ACCOUNT')
      || (lastOrder !== null && lastOrder.eventKind !== 'ORDER')
      || (lastFill !== null && lastFill.eventKind !== 'FILL')
      || (lastPrivate === null) !== (lastAccount === null && lastOrder === null && lastFill === null)
      || (lastPrivate !== null
        && !nonNullCategoryMarkers.some((marker) => sameMarker(marker, lastPrivate)))
      || (lastPrivate !== null
        && nonNullCategoryMarkers.some((marker) => marker.receiptTimeMs > lastPrivate.receiptTimeMs))
      || new Set(nonNullCategoryMarkers.map((marker) => marker.eventRevision)).size
        !== nonNullCategoryMarkers.length
      || (lastPrivate !== null && lastPrivate.receiptTimeMs > (lastObservedAtMs ?? 0))
      || markers.some((marker) => marker.accountRealmId !== accountRealmId
        || marker.generation !== state.generation
        || marker.receiptTimeMs < ((state.connectedAtMs as number | null) ?? 0)
        || marker.receiptTimeMs > (lastObservedAtMs ?? 0)
        || !markerWithinFutureSkew(marker))
      || [lastPrivate, lastAccount, lastOrder, lastFill].some(
        (marker) => marker !== null
          && (marker.accountRealmId !== accountRealmId
            || marker.generation !== state.generation
            || marker.receiptTimeMs < ((state.connectedAtMs as number | null) ?? 0)
            || !markerWithinFutureSkew(marker)),
      )
      || state.observedPrivateEventCount < markers.length
      || state.unretainedPrivateEventObservationCount > state.observedPrivateEventCount
      || state.unretainedPrivateEventObservationCount
        !== state.privateEventDuplicateObservationCount
          + state.privateEventConflictObservationCount
          + state.staleGenerationEventCount
      || state.privateEventDuplicateObservationCount > state.duplicateCount
      || state.privateEventConflictObservationCount > state.conflictingEventCount
      || markers.some((marker, index) => index > 0
        && marker.receiptTimeMs < markers[index - 1]!.receiptTimeMs)
      || state.lastExchangeEventTimeMs !== (lastPrivate?.exchangeEventTimeMs ?? null)
      || (!state.dedupeCoverageTruncated
        && (state.observedPrivateEventCount !== markers.length
            + state.unretainedPrivateEventObservationCount
          || markers.length >= SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS
          || state.observedPrivateEventCount > SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS))
      || ((state.dedupeCoverageTruncated || state.duplicateCount > 0
          || state.outOfOrderCount > 0
          || state.malformedCount > 0 || state.staleGenerationEventCount > 0
          || state.conflictingEventCount > 0)
        !== (state.lastQualityLossAtMs !== null))
      || (state.lastQualityLossAtMs !== null
        && state.lastQualityLossAtMs > (lastObservedAtMs ?? 0))
      || state.qualityPosture !== (state.lastQualityLossAtMs === null
        ? 'CLEAN' : 'CURRENT_GENERATION_DEGRADED')
      || state.integrityPosture !== integrityDerived({
        dedupeCoverageTruncated: state.dedupeCoverageTruncated,
        duplicateCount: state.duplicateCount,
        outOfOrderCount: state.outOfOrderCount,
        malformedCount: state.malformedCount,
        staleGenerationEventCount: state.staleGenerationEventCount,
        conflictingEventCount: state.conflictingEventCount,
        lastQualityLossAtMs: state.lastQualityLossAtMs as number | null,
        lastContinuityBreakAtMs: state.lastContinuityBreakAtMs as number | null,
        ownerRestCut: cut,
      })) return null;

    for (const watermark of watermarks) {
      const marker = categoryMarkers.get(watermark.eventKind) ?? null;
      if (marker === null || marker.exchangeEventTimeMs !== watermark.exchangeEventTimeMs) return null;
      if (markers.some((candidate) => candidate.eventKind === watermark.eventKind
        && candidate.exchangeEventTimeMs > watermark.exchangeEventTimeMs)) return null;
    }
    for (const [eventKind, marker] of categoryMarkers) {
      if (marker !== null && !watermarks.some((watermark) => watermark.eventKind === eventKind)) return null;
    }
    if (!state.dedupeCoverageTruncated) {
      const replayed = replaySpotPrivateMarkers(markers);
      const retained = (marker: Readonly<SpotPrivateEventMarker> | null) => marker === null
        || markers.some((candidate) => sameMarker(candidate, marker));
      if (!retained(lastPrivate) || !retained(lastAccount) || !retained(lastOrder) || !retained(lastFill)) {
        return null;
      }
      if (!sameWatermarks(watermarks, replayed.eventWatermarks)
        || !sameMarker(lastPrivate, replayed.lastPrivateEventMarker)
        || !sameMarker(lastAccount, replayed.lastAccountEventMarker)
        || !sameMarker(lastOrder, replayed.lastOrderEventMarker)
        || !sameMarker(lastFill, replayed.lastFillEventMarker)) return null;
    }
    if (cut !== null) {
      if (state.generation === null || cut.generation !== state.generation
        || cut.accountRealmId !== accountRealmId
        || cut.reconciledAtMs < (state.connectedAtMs ?? 0)
        || cut.reconciledAtMs > (state.lastObservedAtMs ?? 0)
        || (cut.throughExchangeEventTimeMs !== null
          && cut.throughExchangeEventTimeMs > cut.reconciledAtMs
          && cut.throughExchangeEventTimeMs - cut.reconciledAtMs
            > SPOT_PRIVATE_MAXIMUM_FUTURE_SKEW_MS)
        || (lastPrivate === null && cut.throughEventRevision !== null)) return null;
      if (cut.throughEventRevision !== null && !state.dedupeCoverageTruncated) {
        const coveredMarker = markers.find((marker) => marker.eventRevision === cut.throughEventRevision);
        if (coveredMarker === undefined
          || coveredMarker.exchangeEventTimeMs !== cut.throughExchangeEventTimeMs) return null;
      }
    }
    const typed = {
      ...(state as unknown as SpotSignatureLifecycleState),
      eventWatermarks: watermarks,
      recentEventMarkers: markers,
      lastPrivateEventMarker: lastPrivate,
      lastAccountEventMarker: lastAccount,
      lastOrderEventMarker: lastOrder,
      lastFillEventMarker: lastFill,
      ownerRestCut: cut,
    } as SpotSignatureLifecycleState;
    const derived = reconciliationDerived(typed);
    const expectedReconnectDue = state.generation === null
      ? false
      : state.connected
        ? (state.lastObservedAtMs as number) >= (state.reconnectPlannedAtMs as number)
        : true;
    if (state.restReconciliationFreshness !== derived.freshness
      || state.restReconciliationLagMs !== derived.lagMs
      || state.continuityPosture !== derived.continuity
      || state.reconnectDue !== expectedReconnectDue) return null;
    const normalized = freezeState(typed);
    return state.stateContentRevision === normalized.stateContentRevision ? normalized : null;
  } catch {
    return null;
  }
}

export function validateSpotSignatureLifecycleState(
  value: unknown,
): Readonly<SpotSignatureLifecycleState> | null {
  return validState(value);
}

function lifecycleIssue(
  code: SpotSignatureLifecycleIssueCode,
  message: string,
): SpotSignatureLifecycleIssue {
  return Object.freeze({ code, message });
}

function reduction(
  accepted: boolean,
  state: Readonly<SpotSignatureLifecycleState>,
  issues: readonly SpotSignatureLifecycleIssue[] = [],
): Readonly<SpotSignatureLifecycleReduction> {
  const validated = validState(state);
  if (validated === null) {
    throw new TypeError('Spot lifecycle reducer emitted a state that failed validator round-trip');
  }
  return Object.freeze({
    schema: 'SPOT_SIGNATURE_PRIVATE_STREAM_REDUCTION_V1' as const,
    accepted,
    issues: Object.freeze([...issues]),
    state: validated,
    sendEligible: false as const,
    externalActionAuthorization: 'NONE' as const,
    actionAuthority: 'NONE_RECORD_ONLY' as const,
  });
}

function rejectedState(
  state: Readonly<SpotSignatureLifecycleState>,
  observedAtMs: number | null,
  counter: 'duplicateCount' | 'outOfOrderCount' | 'malformedCount',
): Readonly<SpotSignatureLifecycleState> {
  const nextObservedAtMs = observedAtMs === null
    ? state.lastObservedAtMs
    : Math.max(state.lastObservedAtMs ?? 0, observedAtMs);
  const qualityLossAtMs = Math.max(
    state.lastQualityLossAtMs ?? 0,
    observedAtMs ?? state.lastObservedAtMs ?? 0,
  );
  const rejected = freezeState({
    ...state,
    lastObservedAtMs: nextObservedAtMs,
    integrityPosture: 'DEGRADED',
    lastTransition: 'OBSERVATION_REJECTED',
    lastContinuityBreakAtMs: state.generation === null
      ? null
      : observedAtMs === null
      ? state.lastContinuityBreakAtMs
      : Math.max(state.lastContinuityBreakAtMs ?? 0, observedAtMs),
    lastQualityLossAtMs: qualityLossAtMs,
    [counter]: incrementCounter(state[counter]),
  });
  return state.connected && state.hardDisconnectAtMs !== null
    && nextObservedAtMs !== null && nextObservedAtMs >= state.hardDisconnectAtMs
    ? disconnectedState(
      rejected,
      nextObservedAtMs,
      'CONNECTION_LIFETIME_EXPIRED',
      'CONNECTION_LIFETIME_EXPIRED',
    )
    : rejected;
}

function disconnectedState(
  state: Readonly<SpotSignatureLifecycleState>,
  observedAtMs: number,
  reason: SpotSignatureDisconnectReason,
  transition: SpotSignatureLifecycleTransitionName,
  extras: DisconnectExtras = {},
): Readonly<SpotSignatureLifecycleState> {
  return freezeState({
    ...state,
    connected: false,
    signatureAuthorized: false,
    subscribed: false,
    subscriptionId: null,
    pendingTerminationSubscriptionId: null,
    sessionActiveSubscriptionCount: 0,
    reconnectDue: true,
    lastObservedAtMs: observedAtMs,
    lastTransition: transition,
    lastDisconnectReason: reason,
    lastContinuityBreakAtMs: observedAtMs,
    serverShutdownCount: extras.serverShutdownCount ?? state.serverShutdownCount,
  });
}

/**
 * Reduces injected Spot signature-subscription observations only. It owns no
 * transport, clock, credentials, account truth, readiness, or action authority.
 */
export function reduceSpotSignatureLifecycle(
  priorValue: unknown,
  observationValue: unknown,
): Readonly<SpotSignatureLifecycleReduction> {
  const prior = validState(priorValue);
  if (prior === null) {
    const state = freezeState({
      ...initialState(),
      integrityPosture: 'DEGRADED',
      lastTransition: 'OBSERVATION_REJECTED',
      lastObservedAtMs: 0,
      lastQualityLossAtMs: 0,
      malformedCount: 1,
    });
    return reduction(false, state, [
      lifecycleIssue('STATE_INVALID', 'Prior Spot signature lifecycle state is invalid'),
    ]);
  }

  let observation: PlainRecord;
  try {
    observation = observationRecord(observationValue);
  } catch {
    return reduction(false, rejectedState(prior, null, 'malformedCount'), [
      lifecycleIssue('OBSERVATION_INVALID', 'Spot lifecycle observation must be exact closed data'),
    ]);
  }

  const kind = observation.kind as keyof typeof OBSERVATION_FIELDS;
  let observationAccountRealmId: string;
  try {
    observationAccountRealmId = privateAccountRealmReference(
      observation.accountRealmId,
      'Spot lifecycle observation accountRealmId',
    );
  } catch {
    return reduction(false, rejectedState(prior, null, 'malformedCount'), [
      lifecycleIssue('OBSERVATION_INVALID', 'Spot lifecycle account realm must be namespaced'),
    ]);
  }
  if (observationAccountRealmId !== prior.accountRealmId) {
    return reduction(false, rejectedState(prior, null, 'malformedCount'), [
      lifecycleIssue(
        'ACCOUNT_REALM_MISMATCH',
        'Spot lifecycle observations cannot cross account-realm identities',
      ),
    ]);
  }
  const generation = observation.generation;
  const observedAtMs = kind === 'PRIVATE_EVENT_OBSERVED'
    ? observation.receiptTimeMs
    : kind === 'OWNER_REST_RECONCILIATION_OBSERVED'
      ? observation.reconciledAtMs
      : observation.observedAtMs;
  if (!positiveInteger(generation) || !nonNegativeInteger(observedAtMs)) {
    return reduction(false, rejectedState(prior, null, 'malformedCount'), [
      lifecycleIssue('OBSERVATION_INVALID', 'Generation and observation time must be bounded integers'),
    ]);
  }

  if (kind === 'CONNECTION_OPENED') {
    const connectedAtMs = observation.connectedAtMs;
    const reconnectPlannedAtMs = observation.reconnectPlannedAtMs;
    let counters: { active: number; lifetime: number };
    try {
      counters = sessionCounters(observation);
    } catch {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('SESSION_COUNTER_INVALID', 'Injected Spot subscription counters are invalid'),
      ]);
    }
    if (!nonNegativeInteger(connectedAtMs) || !nonNegativeInteger(reconnectPlannedAtMs)
      || connectedAtMs > observedAtMs
      || connectedAtMs > Number.MAX_SAFE_INTEGER - CONNECTION_LIFETIME_MS
      || reconnectPlannedAtMs <= observedAtMs
      || reconnectPlannedAtMs >= connectedAtMs + CONNECTION_LIFETIME_MS) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('RECONNECT_PLAN_INVALID', 'Reconnect must be planned before the 24-hour hard boundary'),
      ]);
    }
    if (prior.generation !== null && generation <= prior.generation) {
      const duplicate = generation === prior.generation;
      return reduction(false, rejectedState(
        prior,
        observedAtMs,
        duplicate ? 'duplicateCount' : 'outOfOrderCount',
      ), [lifecycleIssue(
        duplicate ? 'CONNECTION_ALREADY_OPEN' : 'GENERATION_INVALID',
        'A connection observation must advance the generation',
      )]);
    }
    if (prior.lastObservedAtMs !== null && observedAtMs < prior.lastObservedAtMs) {
      return reduction(false, rejectedState(prior, observedAtMs, 'outOfOrderCount'), [
        lifecycleIssue('OBSERVATION_OUT_OF_ORDER', 'Connection observation predates accepted lifecycle state'),
      ]);
    }
    return reduction(true, freezeState({
      ...prior,
      connected: true,
      signatureAuthorized: false,
      subscribed: false,
      generation,
      connectedAtMs,
      reconnectPlannedAtMs,
      hardDisconnectAtMs: connectedAtMs + CONNECTION_LIFETIME_MS,
      reconnectDue: false,
      lastObservedAtMs: observedAtMs,
      lastExchangeEventTimeMs: null,
      subscriptionId: null,
      pendingTerminationSubscriptionId: null,
      sessionActiveSubscriptionCount: counters.active,
      sessionLifetimeSubscriptionCount: counters.lifetime,
      eventWatermarks: Object.freeze([]),
      recentEventMarkers: Object.freeze([]),
      dedupeCoverageTruncated: false,
      duplicateCount: 0,
      outOfOrderCount: 0,
      malformedCount: 0,
      staleGenerationEventCount: 0,
      conflictingEventCount: 0,
      observedPrivateEventCount: 0,
      unretainedPrivateEventObservationCount: 0,
      privateEventDuplicateObservationCount: 0,
      privateEventConflictObservationCount: 0,
      lastQualityLossAtMs: null,
      lastPrivateEventMarker: null,
      lastAccountEventMarker: null,
      lastOrderEventMarker: null,
      lastFillEventMarker: null,
      lastContinuityBreakAtMs: observedAtMs,
      ownerRestCut: null,
      lastTransition: 'CONNECTION_OPENED',
      lastDisconnectReason: null,
      connectionCount: incrementCounter(prior.connectionCount),
      reconnectCount: prior.generation === null
        ? prior.reconnectCount
        : Math.min(
          incrementCounter(prior.reconnectCount),
          incrementCounter(prior.connectionCount) - 1,
        ),
    }));
  }

  let observedPrivateMarker: Readonly<SpotPrivateEventMarker> | null = null;
  if (kind === 'PRIVATE_EVENT_OBSERVED') {
    try {
      observedPrivateMarker = markerFromObservation(observation);
    } catch {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('PRIVATE_EVENT_INVALID', 'Spot private event identity is invalid'),
      ]);
    }
    if (observedPrivateMarker.exchangeEventTimeMs > observedPrivateMarker.receiptTimeMs
      && observedPrivateMarker.exchangeEventTimeMs - observedPrivateMarker.receiptTimeMs
        > SPOT_PRIVATE_MAXIMUM_FUTURE_SKEW_MS) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('PRIVATE_EVENT_TIME_IN_FUTURE', 'Spot private event exceeds future-skew tolerance'),
      ]);
    }
    if (prior.observedPrivateEventCount >= MAXIMUM_DIAGNOSTIC_COUNTER) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue(
          'COUNTER_LIMIT_REACHED',
          'Spot private-event observation accounting reached its deterministic bound',
        ),
      ]);
    }
    if (prior.generation !== null && generation < prior.generation) {
      const observedPrivateEventCount = incrementCounter(prior.observedPrivateEventCount);
      const unretainedPrivateEventObservationCount = incrementCounter(
        prior.unretainedPrivateEventObservationCount,
      );
      const fenced = freezeState({
        ...prior,
        lastObservedAtMs: Math.max(prior.lastObservedAtMs ?? 0, observedPrivateMarker.receiptTimeMs),
        integrityPosture: 'DEGRADED',
        lastTransition: 'STALE_GENERATION_EVENT_FENCED',
        staleGenerationEventCount: incrementCounter(prior.staleGenerationEventCount),
        lastQualityLossAtMs: Math.max(
          prior.lastQualityLossAtMs ?? 0,
          observedPrivateMarker.receiptTimeMs,
        ),
        observedPrivateEventCount,
        unretainedPrivateEventObservationCount,
        dedupeCoverageTruncated: prior.dedupeCoverageTruncated
          || observedPrivateEventCount > SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS,
      });
      if (prior.connected && prior.hardDisconnectAtMs !== null
        && observedAtMs >= prior.hardDisconnectAtMs) {
        return reduction(true, disconnectedState(
          fenced,
          observedAtMs,
          'CONNECTION_LIFETIME_EXPIRED',
          'CONNECTION_LIFETIME_EXPIRED',
        ), [lifecycleIssue(
          'CONNECTION_LIFETIME_EXPIRED',
          'Stale-generation event was fenced at or after the current Spot connection hard lifetime',
        )]);
      }
      return reduction(true, fenced);
    }
  }

  if (prior.generation === null || generation !== prior.generation) {
    const stale = prior.generation !== null && generation < prior.generation;
    return reduction(false, rejectedState(
      prior,
      observedAtMs,
      stale ? 'outOfOrderCount' : 'malformedCount',
    ), [lifecycleIssue(
      'GENERATION_INVALID',
      'Lifecycle observations cannot cross connection generations',
    )]);
  }
  if (prior.lastObservedAtMs !== null && observedAtMs < prior.lastObservedAtMs) {
    return reduction(false, rejectedState(prior, observedAtMs, 'outOfOrderCount'), [
      lifecycleIssue('OBSERVATION_OUT_OF_ORDER', 'Lifecycle observation time moved backwards'),
    ]);
  }

  if (kind !== 'CLOCK_OBSERVED' && prior.connected
    && prior.hardDisconnectAtMs !== null && observedAtMs >= prior.hardDisconnectAtMs) {
    return reduction(false, disconnectedState(
      prior,
      observedAtMs,
      'CONNECTION_LIFETIME_EXPIRED',
      'CONNECTION_LIFETIME_EXPIRED',
    ), [lifecycleIssue(
      'CONNECTION_LIFETIME_EXPIRED',
      'Observation arrived at or after the Spot connection hard lifetime',
    )]);
  }

  if (kind === 'CLOCK_OBSERVED') {
    if (!prior.connected || prior.hardDisconnectAtMs === null || prior.reconnectPlannedAtMs === null) {
      return reduction(true, freezeState({
        ...prior,
        lastObservedAtMs: observedAtMs,
        lastTransition: 'CLOCK_OBSERVED',
      }));
    }
    if (observedAtMs >= prior.hardDisconnectAtMs) {
      return reduction(true, disconnectedState(
        prior,
        observedAtMs,
        'CONNECTION_LIFETIME_EXPIRED',
        'CONNECTION_LIFETIME_EXPIRED',
      ), [lifecycleIssue(
        'CONNECTION_LIFETIME_EXPIRED',
        'Spot WebSocket API connection reached its 24-hour hard lifetime',
      )]);
    }
    return reduction(true, freezeState({
      ...prior,
      reconnectDue: observedAtMs >= prior.reconnectPlannedAtMs,
      lastObservedAtMs: observedAtMs,
      lastTransition: 'CLOCK_OBSERVED',
    }));
  }

  if (kind === 'CONNECTION_CLOSED') {
    if (observation.reason !== 'TRANSPORT_CLOSED' && observation.reason !== 'PLANNED_RECONNECT') {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('OBSERVATION_INVALID', 'Spot connection close reason is invalid'),
      ]);
    }
    if (!prior.connected) {
      return reduction(false, rejectedState(prior, observedAtMs, 'duplicateCount'), [
        lifecycleIssue('CONNECTION_NOT_OPEN', 'Connection is already closed'),
      ]);
    }
    return reduction(true, disconnectedState(
      prior,
      observedAtMs,
      observation.reason,
      'CONNECTION_CLOSED',
    ));
  }

  if (kind === 'SERVER_SHUTDOWN_OBSERVED') {
    if (!nonNegativeInteger(observation.exchangeEventTimeMs)) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('OBSERVATION_INVALID', 'Server-shutdown exchange time is invalid'),
      ]);
    }
    const exchangeEventTimeMs = observation.exchangeEventTimeMs;
    if (exchangeEventTimeMs > observedAtMs
      && exchangeEventTimeMs - observedAtMs > SPOT_PRIVATE_MAXIMUM_FUTURE_SKEW_MS) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue(
          'EXCHANGE_EVENT_TIME_IN_FUTURE',
          'Server-shutdown exchange time exceeds future-skew tolerance',
        ),
      ]);
    }
    if (!prior.connected) {
      return reduction(false, rejectedState(prior, observedAtMs, 'duplicateCount'), [
        lifecycleIssue('CONNECTION_NOT_OPEN', 'Server shutdown cannot close an absent connection'),
      ]);
    }
    const exchangeTimeRegressed = prior.lastExchangeEventTimeMs !== null
      && exchangeEventTimeMs < prior.lastExchangeEventTimeMs;
    const disconnected = disconnectedState(
      prior,
      observedAtMs,
      'SERVER_SHUTDOWN',
      'SERVER_SHUTDOWN_OBSERVED',
      {
        serverShutdownCount: incrementCounter(prior.serverShutdownCount),
      },
    );
    return reduction(true, exchangeTimeRegressed ? freezeState({
      ...disconnected,
      integrityPosture: 'DEGRADED',
      outOfOrderCount: incrementCounter(prior.outOfOrderCount),
      lastQualityLossAtMs: observedAtMs,
    }) : disconnected, exchangeTimeRegressed ? [
      lifecycleIssue(
        'OBSERVATION_OUT_OF_ORDER',
        'Server-shutdown exchange time regressed behind the retained watermark',
      ),
    ] : []);
  }

  if (kind === 'EVENT_QUALITY_OBSERVED') {
    if (observation.quality !== 'DUPLICATE'
      && observation.quality !== 'OUT_OF_ORDER'
      && observation.quality !== 'MALFORMED'
      && observation.quality !== 'CONFLICT') {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('OBSERVATION_INVALID', 'Private event quality is invalid'),
      ]);
    }
    const counter = observation.quality === 'DUPLICATE'
      ? 'duplicateCount'
      : observation.quality === 'OUT_OF_ORDER'
        ? 'outOfOrderCount'
        : observation.quality === 'MALFORMED'
          ? 'malformedCount'
          : 'conflictingEventCount';
    return reduction(true, freezeState({
      ...prior,
      integrityPosture: 'DEGRADED',
      lastObservedAtMs: observedAtMs,
      lastTransition: 'EVENT_QUALITY_OBSERVED',
      lastContinuityBreakAtMs: observedAtMs,
      lastQualityLossAtMs: observedAtMs,
      [counter]: incrementCounter(prior[counter]),
    }));
  }

  if (kind === 'OWNER_REST_RECONCILIATION_OBSERVED') {
    let cut: Readonly<SpotOwnerRestReconciliationCut> | null;
    try {
      cut = ownerRestCut({
        accountRealmId: observationAccountRealmId,
        generation,
        reconciliationRevision: observation.reconciliationRevision,
        reconciledAtMs: observation.reconciledAtMs,
        validUntilMs: observation.validUntilMs,
        throughEventRevision: observation.throughEventRevision,
        throughExchangeEventTimeMs: observation.throughExchangeEventTimeMs,
      });
    } catch {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('REST_RECONCILIATION_CUT_INVALID', 'Owner REST reconciliation cut is invalid'),
      ]);
    }
    if (cut === null || cut.generation !== prior.generation
      || (cut.throughExchangeEventTimeMs !== null
        && cut.throughExchangeEventTimeMs > cut.reconciledAtMs
        && cut.throughExchangeEventTimeMs - cut.reconciledAtMs
          > SPOT_PRIVATE_MAXIMUM_FUTURE_SKEW_MS)
      || (prior.lastPrivateEventMarker === null && cut.throughEventRevision !== null)) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('REST_RECONCILIATION_CUT_INVALID', 'Owner REST cut conflicts with current generation'),
      ]);
    }
    if (cut.throughEventRevision !== null) {
      const through = prior.recentEventMarkers.find(
        (marker) => marker.eventRevision === cut!.throughEventRevision,
      );
      if (through === undefined
        || through.exchangeEventTimeMs !== cut.throughExchangeEventTimeMs) {
        return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
          lifecycleIssue(
            'REST_RECONCILIATION_CUT_INVALID',
            'Owner REST cut through-event is not retained in this generation',
          ),
        ]);
      }
    }
    if (prior.ownerRestCut?.reconciliationRevision === cut.reconciliationRevision) {
      const exact = prior.ownerRestCut.generation === cut.generation
        && prior.ownerRestCut.accountRealmId === cut.accountRealmId
        && prior.ownerRestCut.reconciledAtMs === cut.reconciledAtMs
        && prior.ownerRestCut.validUntilMs === cut.validUntilMs
        && prior.ownerRestCut.throughEventRevision === cut.throughEventRevision
        && prior.ownerRestCut.throughExchangeEventTimeMs === cut.throughExchangeEventTimeMs;
      if (!exact) {
        return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
          lifecycleIssue(
            'REST_RECONCILIATION_CUT_INVALID',
            'One owner reconciliation revision cannot describe conflicting cuts',
          ),
        ]);
      }
    }
    return reduction(true, freezeState({
      ...prior,
      ownerRestCut: cut,
      lastObservedAtMs: observedAtMs,
      lastTransition: 'OWNER_REST_RECONCILIATION_OBSERVED',
    }));
  }

  if (kind === 'PRIVATE_EVENT_OBSERVED') {
    const marker = observedPrivateMarker;
    if (marker === null) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('PRIVATE_EVENT_INVALID', 'Spot private event was not normalized'),
      ]);
    }
    if (!prior.connected || !prior.signatureAuthorized || !prior.subscribed) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue(
          'PRIVATE_EVENT_REQUIRES_SUBSCRIPTION',
          'Current-generation Spot private event requires the selected active subscription',
        ),
      ]);
    }
    const observedPrivateEventCount = incrementCounter(prior.observedPrivateEventCount);
    const observationCoverageTruncated = prior.dedupeCoverageTruncated
      || observedPrivateEventCount > SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS;
    const existing = prior.recentEventMarkers.find(
      (candidate) => candidate.eventRevision === marker.eventRevision
        || sameEventBaseIdentity(candidate, marker),
    );
    if (existing !== undefined) {
      if (sameEventIdentity(existing, marker)) {
        return reduction(true, freezeState({
          ...prior,
          observedPrivateEventCount,
          unretainedPrivateEventObservationCount: incrementCounter(
            prior.unretainedPrivateEventObservationCount,
          ),
          dedupeCoverageTruncated: observationCoverageTruncated,
          duplicateCount: incrementCounter(prior.duplicateCount),
          privateEventDuplicateObservationCount: incrementCounter(
            prior.privateEventDuplicateObservationCount,
          ),
          integrityPosture: observationCoverageTruncated ? 'DEGRADED' : prior.integrityPosture,
          lastObservedAtMs: marker.receiptTimeMs,
          lastContinuityBreakAtMs: marker.receiptTimeMs,
          lastQualityLossAtMs: marker.receiptTimeMs,
          lastTransition: 'PRIVATE_EVENT_DUPLICATE',
        }));
      }
      return reduction(true, freezeState({
        ...prior,
        observedPrivateEventCount,
        unretainedPrivateEventObservationCount: incrementCounter(
          prior.unretainedPrivateEventObservationCount,
        ),
        dedupeCoverageTruncated: observationCoverageTruncated,
        conflictingEventCount: incrementCounter(prior.conflictingEventCount),
        privateEventConflictObservationCount: incrementCounter(
          prior.privateEventConflictObservationCount,
        ),
        integrityPosture: 'DEGRADED',
        lastObservedAtMs: marker.receiptTimeMs,
        lastContinuityBreakAtMs: marker.receiptTimeMs,
        lastQualityLossAtMs: marker.receiptTimeMs,
        lastTransition: 'PRIVATE_EVENT_CONFLICT',
      }));
    }

    const priorWatermark = prior.eventWatermarks.find(
      (watermark) => watermark.eventKind === marker.eventKind,
    );
    const outOfOrder = priorWatermark !== undefined
      && marker.exchangeEventTimeMs <= priorWatermark.exchangeEventTimeMs;
    const coverageWillTruncate = prior.recentEventMarkers.length + 1
      >= SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS;
    const recentEventMarkers = Object.freeze([
      ...prior.recentEventMarkers,
      marker,
    ].slice(-SPOT_PRIVATE_MAXIMUM_RECENT_EVENT_MARKERS));

    if (outOfOrder) {
      return reduction(true, freezeState({
        ...prior,
        observedPrivateEventCount,
        recentEventMarkers,
        dedupeCoverageTruncated: observationCoverageTruncated || coverageWillTruncate,
        outOfOrderCount: incrementCounter(prior.outOfOrderCount),
        integrityPosture: 'DEGRADED',
        lastObservedAtMs: marker.receiptTimeMs,
        lastContinuityBreakAtMs: marker.receiptTimeMs,
        lastQualityLossAtMs: marker.receiptTimeMs,
        lastTransition: 'PRIVATE_EVENT_OUT_OF_ORDER',
      }));
    }

    const eventWatermarks = Object.freeze([
      ...prior.eventWatermarks.filter((watermark) => watermark.eventKind !== marker.eventKind),
      Object.freeze({
        eventKind: marker.eventKind,
        exchangeEventTimeMs: marker.exchangeEventTimeMs,
      }),
    ].sort((left, right) => left.eventKind < right.eventKind ? -1 : left.eventKind > right.eventKind ? 1 : 0));
    return reduction(true, freezeState({
      ...prior,
      observedPrivateEventCount,
      eventWatermarks,
      recentEventMarkers,
      dedupeCoverageTruncated: observationCoverageTruncated || coverageWillTruncate,
      lastPrivateEventMarker: marker,
      lastAccountEventMarker: marker.eventKind === 'ACCOUNT' ? marker : prior.lastAccountEventMarker,
      lastOrderEventMarker: marker.eventKind === 'ORDER' ? marker : prior.lastOrderEventMarker,
      lastFillEventMarker: marker.eventKind === 'FILL' ? marker : prior.lastFillEventMarker,
      lastExchangeEventTimeMs: marker.exchangeEventTimeMs,
      lastObservedAtMs: marker.receiptTimeMs,
      integrityPosture: observationCoverageTruncated || coverageWillTruncate
        ? 'DEGRADED'
        : prior.integrityPosture,
      lastContinuityBreakAtMs: observationCoverageTruncated || coverageWillTruncate
        ? marker.receiptTimeMs
        : prior.lastContinuityBreakAtMs,
      lastQualityLossAtMs: observationCoverageTruncated || coverageWillTruncate
        ? marker.receiptTimeMs
        : prior.lastQualityLossAtMs,
      lastTransition: 'PRIVATE_EVENT_ACCEPTED',
    }));
  }

  let counters: { active: number; lifetime: number };
  try {
    counters = sessionCounters(observation);
  } catch {
    return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
      lifecycleIssue('SESSION_COUNTER_INVALID', 'Injected Spot subscription counters are invalid'),
    ]);
  }
  if (counters.lifetime < prior.sessionLifetimeSubscriptionCount) {
    return reduction(false, rejectedState(prior, observedAtMs, 'outOfOrderCount'), [
      lifecycleIssue('SESSION_COUNTER_CONFLICT', 'Lifetime subscription count cannot decrease in a generation'),
    ]);
  }

  if (kind === 'SESSION_LOGOUT_OBSERVED') {
    if (!prior.connected) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('CONNECTION_NOT_OPEN', 'Session logout requires an open connection'),
      ]);
    }
    if (counters.active !== prior.sessionActiveSubscriptionCount
      || counters.lifetime !== prior.sessionLifetimeSubscriptionCount) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue(
          'SESSION_COUNTER_CONFLICT',
          'Session logout cannot close or alter a signature subscription',
        ),
      ]);
    }
    return reduction(true, freezeState({
      ...prior,
      lastObservedAtMs: observedAtMs,
      lastTransition: 'SESSION_LOGOUT_OBSERVED_SIGNATURE_UNCHANGED',
      logoutCount: incrementCounter(prior.logoutCount),
    }));
  }

  if (!prior.connected) {
    return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
      lifecycleIssue('CONNECTION_NOT_OPEN', 'Subscription control requires the current connection generation'),
    ]);
  }

  if (kind === 'SIGNATURE_SUBSCRIPTION_ACCEPTED') {
    if (!nonNegativeInteger(observation.subscriptionId)) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('OBSERVATION_INVALID', 'Subscription id must be a non-negative safe integer'),
      ]);
    }
    if (prior.subscribed) {
      return reduction(false, rejectedState(prior, observedAtMs, 'duplicateCount'), [
        lifecycleIssue('ACCOUNT_ALREADY_SUBSCRIBED', 'Only one subscription per account is current'),
      ]);
    }
    if (prior.pendingTerminationSubscriptionId !== null) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue(
          'TERMINATION_CONFIRMATION_PENDING',
          'A prior unsubscribe termination must be attributed before resubscribing this account',
        ),
      ]);
    }
    if (prior.sessionActiveSubscriptionCount >= MAXIMUM_ACTIVE_SUBSCRIPTIONS) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('ACTIVE_SUBSCRIPTION_LIMIT_REACHED', 'Session already has 1,000 active subscriptions'),
      ]);
    }
    if (prior.sessionLifetimeSubscriptionCount >= MAXIMUM_LIFETIME_SUBSCRIPTIONS) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('LIFETIME_SUBSCRIPTION_LIMIT_REACHED', 'Session reached 65,535 lifetime subscriptions'),
      ]);
    }
    if (counters.active !== prior.sessionActiveSubscriptionCount + 1
      || counters.lifetime !== prior.sessionLifetimeSubscriptionCount + 1) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('SESSION_COUNTER_CONFLICT', 'Subscribe acceptance must increment both session counters once'),
      ]);
    }
    return reduction(true, freezeState({
      ...prior,
      signatureAuthorized: true,
      subscribed: true,
      subscriptionId: observation.subscriptionId,
      pendingTerminationSubscriptionId: null,
      sessionActiveSubscriptionCount: counters.active,
      sessionLifetimeSubscriptionCount: counters.lifetime,
      lastObservedAtMs: observedAtMs,
      lastTransition: 'SIGNATURE_SUBSCRIPTION_ACCEPTED',
    }));
  }

  if (kind === 'SIGNATURE_SUBSCRIPTION_REJECTED') {
    if (counters.active !== prior.sessionActiveSubscriptionCount
      || counters.lifetime !== prior.sessionLifetimeSubscriptionCount) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('SESSION_COUNTER_CONFLICT', 'Rejected subscription cannot change session counters'),
      ]);
    }
    return reduction(true, freezeState({
      ...prior,
      signatureAuthorized: false,
      subscribed: false,
      subscriptionId: null,
      integrityPosture: 'DEGRADED',
      lastObservedAtMs: observedAtMs,
      lastContinuityBreakAtMs: observedAtMs,
      lastTransition: 'SIGNATURE_SUBSCRIPTION_REJECTED',
    }));
  }

  if (kind === 'UNSUBSCRIBE_ACCEPTED') {
    const scope = observation.scope;
    const subscriptionId = observation.subscriptionId;
    if ((scope !== 'TARGETED' && scope !== 'ALL')
      || (scope === 'TARGETED' && !nonNegativeInteger(subscriptionId))
      || (scope === 'ALL' && subscriptionId !== null)) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('OBSERVATION_INVALID', 'Unsubscribe scope and subscription id conflict'),
      ]);
    }
    if (counters.lifetime !== prior.sessionLifetimeSubscriptionCount) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('SESSION_COUNTER_CONFLICT', 'Unsubscribe cannot change lifetime count'),
      ]);
    }
    if (scope === 'ALL') {
      if (counters.active !== 0) {
        return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
          lifecycleIssue('SESSION_COUNTER_CONFLICT', 'Unsubscribe-all must leave zero active subscriptions'),
        ]);
      }
      return reduction(true, freezeState({
        ...prior,
        subscribed: false,
        subscriptionId: null,
        pendingTerminationSubscriptionId: prior.subscribed
          ? prior.subscriptionId
          : prior.pendingTerminationSubscriptionId,
        sessionActiveSubscriptionCount: 0,
        lastObservedAtMs: observedAtMs,
        lastContinuityBreakAtMs: prior.subscribed
          || prior.pendingTerminationSubscriptionId !== null
          ? observedAtMs
          : prior.lastContinuityBreakAtMs,
        lastTransition: 'ALL_UNSUBSCRIBE_ACCEPTED',
        unsubscribeCount: incrementCounter(prior.unsubscribeCount),
      }));
    }
    if (prior.sessionActiveSubscriptionCount < 1
      || counters.active !== prior.sessionActiveSubscriptionCount - 1) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('SESSION_COUNTER_CONFLICT', 'Targeted unsubscribe must remove one active subscription'),
      ]);
    }
    const affectsSelected = prior.subscribed && subscriptionId === prior.subscriptionId;
    if (!affectsSelected && prior.subscribed && counters.active < 1) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue(
          'SESSION_COUNTER_CONFLICT',
          'An unrelated targeted unsubscribe cannot erase the tracked active-count evidence',
        ),
      ]);
    }
    return reduction(true, freezeState({
      ...prior,
      subscribed: affectsSelected ? false : prior.subscribed,
      subscriptionId: affectsSelected ? null : prior.subscriptionId,
      pendingTerminationSubscriptionId: affectsSelected
        ? prior.subscriptionId
        : prior.pendingTerminationSubscriptionId,
      sessionActiveSubscriptionCount: counters.active,
      lastObservedAtMs: observedAtMs,
      lastContinuityBreakAtMs: affectsSelected
        ? observedAtMs
        : prior.lastContinuityBreakAtMs,
      lastTransition: 'TARGETED_UNSUBSCRIBE_ACCEPTED',
      unsubscribeCount: incrementCounter(prior.unsubscribeCount),
    }));
  }

  if (kind === 'EVENT_STREAM_TERMINATED') {
    const subscriptionId = observation.subscriptionId;
    const exchangeEventTimeMs = observation.exchangeEventTimeMs;
    if (!optionalInteger(subscriptionId) || !nonNegativeInteger(exchangeEventTimeMs)) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('OBSERVATION_INVALID', 'Termination identity or exchange time is invalid'),
      ]);
    }
    if (exchangeEventTimeMs > observedAtMs
      && exchangeEventTimeMs - observedAtMs > SPOT_PRIVATE_MAXIMUM_FUTURE_SKEW_MS) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue(
          'EXCHANGE_EVENT_TIME_IN_FUTURE',
          'Termination exchange time exceeds future-skew tolerance',
        ),
      ]);
    }
    const exchangeTimeRegressed = prior.lastExchangeEventTimeMs !== null
      && exchangeEventTimeMs < prior.lastExchangeEventTimeMs;
    const exchangeTimeIssues = exchangeTimeRegressed ? [
      lifecycleIssue(
        'OBSERVATION_OUT_OF_ORDER',
        'Termination exchange time regressed behind the retained watermark',
      ),
    ] : [];
    const completesPendingTermination = prior.pendingTerminationSubscriptionId !== null
      && (subscriptionId === null || subscriptionId === prior.pendingTerminationSubscriptionId);
    if (completesPendingTermination) {
      if (counters.active !== prior.sessionActiveSubscriptionCount
        || counters.lifetime !== prior.sessionLifetimeSubscriptionCount) {
        return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
          lifecycleIssue(
            'SESSION_COUNTER_CONFLICT',
            'Unsubscribe termination confirmation cannot decrement session counters twice',
          ),
        ]);
      }
      const unattributedPending = subscriptionId === null;
      return reduction(true, freezeState({
        ...prior,
        pendingTerminationSubscriptionId: null,
        integrityPosture: unattributedPending || exchangeTimeRegressed
          ? 'DEGRADED'
          : prior.integrityPosture,
        lastObservedAtMs: observedAtMs,
        lastContinuityBreakAtMs: observedAtMs,
        lastTransition: 'EVENT_STREAM_TERMINATED',
        terminationCount: incrementCounter(prior.terminationCount),
        outOfOrderCount: exchangeTimeRegressed
          ? incrementCounter(prior.outOfOrderCount)
          : prior.outOfOrderCount,
        lastQualityLossAtMs: exchangeTimeRegressed
          ? observedAtMs
          : prior.lastQualityLossAtMs,
      }), [
        ...(unattributedPending ? [lifecycleIssue(
          'SUBSCRIPTION_ID_UNATTRIBUTED',
          'Termination confirmed a pending stop without an attributable subscription id',
        )] : []),
        ...exchangeTimeIssues,
      ]);
    }
    if (counters.lifetime !== prior.sessionLifetimeSubscriptionCount
      || prior.sessionActiveSubscriptionCount < 1
      || counters.active !== prior.sessionActiveSubscriptionCount - 1) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue('SESSION_COUNTER_CONFLICT', 'Termination must remove exactly one active subscription'),
      ]);
    }
    const unattributed = subscriptionId === null;
    const affectsSelected = prior.subscribed
      && (unattributed || subscriptionId === prior.subscriptionId);
    if (!affectsSelected && prior.subscribed && counters.active < 1) {
      return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
        lifecycleIssue(
          'SESSION_COUNTER_CONFLICT',
          'An unrelated termination cannot erase the tracked active-count evidence',
        ),
      ]);
    }
    const next = freezeState({
      ...prior,
      subscribed: affectsSelected ? false : prior.subscribed,
      subscriptionId: affectsSelected ? null : prior.subscriptionId,
      sessionActiveSubscriptionCount: counters.active,
      integrityPosture: unattributed || exchangeTimeRegressed
        ? 'DEGRADED'
        : prior.integrityPosture,
      lastObservedAtMs: observedAtMs,
      lastContinuityBreakAtMs: affectsSelected || exchangeTimeRegressed
        ? observedAtMs
        : prior.lastContinuityBreakAtMs,
      lastTransition: 'EVENT_STREAM_TERMINATED',
      terminationCount: incrementCounter(prior.terminationCount),
      outOfOrderCount: exchangeTimeRegressed
        ? incrementCounter(prior.outOfOrderCount)
        : prior.outOfOrderCount,
      lastQualityLossAtMs: exchangeTimeRegressed
        ? observedAtMs
        : prior.lastQualityLossAtMs,
    });
    return reduction(true, next, [
      ...(unattributed ? [lifecycleIssue(
        'SUBSCRIPTION_ID_UNATTRIBUTED',
        'Selected multi-account signature route cannot attribute a missing subscription id',
      )] : []),
      ...exchangeTimeIssues,
    ]);
  }

  return reduction(false, rejectedState(prior, observedAtMs, 'malformedCount'), [
    lifecycleIssue('OBSERVATION_INVALID', 'Spot lifecycle observation is unsupported'),
  ]);
}

export function reduceSpotPrivateLifecycle(
  priorValue: unknown,
  observationValue: unknown,
): Readonly<SpotSignatureLifecycleReduction> {
  return reduceSpotSignatureLifecycle(priorValue, observationValue);
}
