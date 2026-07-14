/**
 * L03 deterministic Binance endpoint-cost and rate-window reducer.
 *
 * This module owns no clock, capacity, transport, credential, timer, or
 * singleton. The caller supplies immutable state, exact L02 contract identity,
 * opaque scope handles, window-capacity evidence, and observation time.
 */

import { types as utilTypes } from 'node:util';

import {
  BINANCE_CONTRACT_MATRIX,
  BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
  BINANCE_RATE_CONDITIONS,
  type BinanceContractRecord,
  type BinanceEnvironment,
  type BinanceMutationClass,
  type BinanceProduct,
  type BinanceRateCondition,
  type BinanceRateInterval,
  type BinanceRateKind,
  type BinanceRateScope,
} from '../binanceContracts/index.js';
import { L03_BINANCE_MATRIX_SHA256 } from './contract.js';

export const BINANCE_RATE_BUDGET_SCHEMA = 'BINANCE_RATE_BUDGET_V2' as const;
export const BINANCE_L03_RATE_MATRIX_SHA256 = L03_BINANCE_MATRIX_SHA256;
export const BINANCE_RATE_BUDGET_MAX_EVENTS = 512 as const;
export const BINANCE_RATE_BUDGET_MAX_INCIDENTS = 128 as const;
export const BINANCE_AUTOMATIC_READ_RETRY_MAXIMUM = 3 as const;

export type BinanceRateWindowInterval =
  | 'SECOND'
  | 'TEN_SECONDS'
  | 'MINUTE'
  | 'FIVE_MINUTES'
  | 'DAY';

export type BinanceRateIncidentStatus = 'COOLDOWN' | 'OPEN_MANUAL';

export interface BinanceEndpointCost {
  readonly sourceId: string;
  readonly rateKind: BinanceRateKind;
  readonly scopeKind: BinanceRateScope;
  readonly claimInterval: BinanceRateInterval;
  readonly condition: BinanceRateCondition;
  /** Endpoint charge from an exact VERIFIED L02 claim; never a capacity. */
  readonly endpointCost: number;
}

export interface BinanceEndpointCostQuote {
  readonly contractId: string;
  readonly product: BinanceProduct;
  readonly environment: BinanceEnvironment;
  readonly matrixContentSha256: typeof BINANCE_L03_RATE_MATRIX_SHA256;
  readonly costs: readonly BinanceEndpointCost[];
}

export interface BinanceRateStateKey {
  readonly product: BinanceProduct;
  readonly environment: BinanceEnvironment;
  readonly contractId: string;
  readonly scopeKind: BinanceRateScope;
  /** Caller-owned opaque identity, never an account value or credential. */
  readonly scopeHandle: string;
  readonly rateKind: BinanceRateKind;
  readonly interval: BinanceRateWindowInterval;
  readonly condition: BinanceRateCondition;
}

export interface BinanceRateWindowCapacity {
  readonly product: BinanceProduct;
  readonly environment: BinanceEnvironment;
  readonly scopeKind: BinanceRateScope;
  readonly scopeHandle: string;
  readonly rateKind: BinanceRateKind;
  readonly interval: BinanceRateWindowInterval;
  /** Capacity evidence is supplied separately from the L02 endpoint cost. */
  readonly capacity: number;
  readonly windowStartedAtMs: number;
  readonly windowEndsAtMs: number;
}

export interface BinanceRateReservationEvent {
  readonly key: BinanceRateStateKey;
  readonly sourceId: string;
  readonly claimInterval: BinanceRateInterval;
  readonly endpointCost: number;
  readonly capacity: number;
  readonly windowStartedAtMs: number;
  readonly windowEndsAtMs: number;
  readonly reservedAtMs: number;
  readonly sequence: number;
}

export interface BinanceRateHeaderEvent {
  readonly key: BinanceRateStateKey;
  readonly used: number;
  readonly capacity: number;
  readonly windowStartedAtMs: number;
  readonly windowEndsAtMs: number;
  readonly observedAtMs: number;
  readonly sequence: number;
}

export interface BinanceRateIncidentKey {
  readonly product: BinanceProduct;
  readonly environment: BinanceEnvironment;
  readonly contractId: string;
  readonly scopeKind: BinanceRateScope;
  readonly scopeHandle: string;
}

export interface BinanceRateIncident {
  readonly key: BinanceRateIncidentKey;
  readonly httpStatus: 418 | 429;
  readonly status: BinanceRateIncidentStatus;
  readonly openedAtMs: number;
  readonly updatedAtMs: number;
  readonly sequence: number;
  /** Null means no automatic next-safe time is proved. */
  readonly nextSafeAtMs: number | null;
}

export interface BinanceRateBudgetState {
  readonly schema: typeof BINANCE_RATE_BUDGET_SCHEMA;
  readonly sequence: number;
  readonly lastEventAtMs: number | null;
  readonly reservations: readonly BinanceRateReservationEvent[];
  readonly headerEvents: readonly BinanceRateHeaderEvent[];
  readonly incidents: readonly BinanceRateIncident[];
}

export interface CanonicalBinanceRateHeaderObservation {
  readonly rateKind: 'REQUEST_WEIGHT' | 'ORDER_COUNT';
  readonly scopeKind: 'IP' | 'ACCOUNT';
  readonly interval: BinanceRateWindowInterval;
  readonly used: number;
}

export interface ParsedCanonicalBinanceRateHeaders {
  readonly observations: readonly CanonicalBinanceRateHeaderObservation[];
  readonly retryAfterTruth: 'VERIFIED' | 'UNKNOWN' | 'UNPROVED_FOR_PRODUCT';
  /** Spot-only, positive digit delta-seconds bounded to the documented ban ceiling. */
  readonly retryAfterDeltaMs: number | null;
}

export interface BinanceRateReservationDecision {
  readonly allowed: boolean;
  readonly reason:
    | 'RESERVED'
    | 'CAPACITY_UNKNOWN'
    | 'CAPACITY_WINDOW_MISMATCH'
    | 'USAGE_UNKNOWN'
    | 'BUDGET_EXHAUSTED'
    | 'COOLDOWN'
    | 'CIRCUIT_OPEN'
    | 'CLOCK_REGRESSION'
    | 'STATE_BOUND';
  readonly nextSafeAtMs: number | null;
  readonly quote: BinanceEndpointCostQuote;
  readonly state: BinanceRateBudgetState;
}

export interface BinanceRateObservationDecision {
  readonly accepted: boolean;
  readonly reason:
    | 'OBSERVED'
    | 'HEADER_REGRESSION'
    | 'CLOCK_REGRESSION'
    | 'CAPACITY_UNKNOWN'
    | 'CAPACITY_WINDOW_MISMATCH'
    | 'USAGE_UNKNOWN'
    | 'INCIDENT_RECORDED'
    | 'STATE_BOUND';
  readonly headerTruth: 'VERIFIED' | 'UNKNOWN';
  readonly retryAfterTruth: ParsedCanonicalBinanceRateHeaders['retryAfterTruth'];
  readonly nextSafeAtMs: number | null;
  readonly state: BinanceRateBudgetState;
}

export type BinanceReadRetryOutcome =
  | 'NOT_SENT'
  | 'HTTP_408'
  | 'HTTP_429'
  | 'HTTP_5XX'
  | 'NETWORK_FAILURE'
  | 'AMBIGUOUS';

export interface BinanceAutomaticReadRetryAdvice {
  readonly automatic: boolean;
  readonly reason:
    | 'READ_ONLY_RETRY'
    | 'MUTATION_BLOCKED'
    | 'MARGIN_BLOCKED'
    | 'PRIVATE_STREAM_BLOCKED'
    | 'AMBIGUOUS_BLOCKED'
    | 'ATTEMPT_LIMIT'
    | 'RATE_STATE_UNKNOWN'
    | 'COOLDOWN_UNKNOWN'
    | 'CLOCK_REGRESSION';
  readonly retryAtMs: number | null;
  readonly remainingAttempts: number;
}

const PRODUCTS = Object.freeze<readonly BinanceProduct[]>(['SPOT', 'USD_M_PERPETUAL', 'MARGIN']);
const ENVIRONMENTS = Object.freeze<readonly BinanceEnvironment[]>(['PRODUCTION', 'DEMO', 'TESTNET']);
const RATE_KINDS = Object.freeze<readonly BinanceRateKind[]>([
  'REQUEST_WEIGHT', 'ORDER_COUNT', 'CONNECTION_ATTEMPT', 'MESSAGE_LIMIT', 'SUBSCRIPTION_LIMIT',
]);
const SCOPE_KINDS = Object.freeze<readonly BinanceRateScope[]>(['IP', 'UID', 'ACCOUNT', 'CONNECTION', 'UNKNOWN']);
const CONDITIONS = Object.freeze<readonly BinanceRateCondition[]>([...BINANCE_RATE_CONDITIONS]);
const CLAIM_INTERVALS = Object.freeze<readonly BinanceRateInterval[]>([
  'REQUEST', 'SECOND', 'TEN_SECONDS', 'MINUTE', 'FIVE_MINUTES', 'DAY',
  'CONNECTION_LIFETIME', 'UNKNOWN',
]);
const WINDOW_INTERVALS = Object.freeze<readonly BinanceRateWindowInterval[]>([
  'SECOND', 'TEN_SECONDS', 'MINUTE', 'FIVE_MINUTES', 'DAY',
]);
const READ_ONLY_MUTATION_CLASSES = Object.freeze<readonly BinanceMutationClass[]>([
  'SOURCE_METADATA_ONLY', 'PRIVATE_ACCOUNT_READ', 'ORDER_QUERY_READ', 'PERMISSION_READ',
]);
const INCIDENT_STATUSES = Object.freeze<readonly BinanceRateIncidentStatus[]>(['COOLDOWN', 'OPEN_MANUAL']);
const READ_RETRY_OUTCOMES = Object.freeze<readonly BinanceReadRetryOutcome[]>([
  'NOT_SENT', 'HTTP_408', 'HTTP_429', 'HTTP_5XX', 'NETWORK_FAILURE', 'AMBIGUOUS',
]);

const INTERVAL_MS: Readonly<Record<BinanceRateWindowInterval, number>> = Object.freeze({
  SECOND: 1_000,
  TEN_SECONDS: 10_000,
  MINUTE: 60_000,
  FIVE_MINUTES: 300_000,
  DAY: 86_400_000,
});

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function isDeeplyFrozenData(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (utilTypes.isProxy(value) || seen.has(value) || !Object.isFrozen(value)) return false;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, 'value') || !isDeeplyFrozenData(descriptor.value, seen)) return false;
  }
  return true;
}

function exactRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || utilTypes.isProxy(value) || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} cannot contain symbol fields`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowedSet = new Set(allowed);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedSet.has(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label} contains unsupported or unsafe fields`);
    }
  }
  for (const key of required) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label} is missing a required field`);
    }
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
  ));
}

function safeInteger(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function boundedIdentifier(value: unknown, label: string, maximum = 128): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    || /^[A-Za-z0-9]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a bounded opaque identifier`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`${label} is outside the closed vocabulary`);
  }
  return value as T;
}

function exactArray(value: unknown, label: string, maximum: number): readonly unknown[] {
  if (typeof value !== 'object' || value === null || utilTypes.isProxy(value)
    || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximum || Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label} must contain data elements only`);
    }
  }
  const extra = Object.keys(descriptors).filter((key) => key !== 'length' && !/^\d+$/.test(key));
  if (extra.length !== 0) throw new TypeError(`${label} contains unsupported fields`);
  return Object.freeze(Array.from(
    { length: value.length },
    (_, index) => (descriptors[String(index)] as PropertyDescriptor).value,
  ));
}

function contractFor(
  contractIdValue: unknown,
  productValue: unknown,
  environmentValue: unknown,
): BinanceContractRecord {
  const contractId = boundedIdentifier(contractIdValue, 'contractId');
  const product = oneOf(productValue, PRODUCTS, 'product');
  const environment = oneOf(environmentValue, ENVIRONMENTS, 'environment');
  if (BINANCE_CONTRACT_MATRIX_CONTENT_SHA256 !== BINANCE_L03_RATE_MATRIX_SHA256
    || BINANCE_CONTRACT_MATRIX.contentSha256 !== BINANCE_L03_RATE_MATRIX_SHA256) {
    throw new Error('L03 accepted L02 matrix literal lock is not intact');
  }
  const matches = BINANCE_CONTRACT_MATRIX.contracts.filter((candidate) => candidate.id === contractId);
  if (matches.length !== 1) throw new RangeError('exact L02 contract ID was not found');
  const contract = matches[0] as BinanceContractRecord;
  if (contract.product !== product || contract.environment !== environment) {
    throw new RangeError('L02 product or environment identity does not match the contract');
  }
  if (contract.lifecycle !== 'CURRENT' || contract.transport !== 'REST'
    || contract.operation?.kind !== 'REST_PATH') {
    throw new RangeError('rate accounting requires an exact current L02 REST contract');
  }
  return contract;
}

function compareCosts(left: BinanceEndpointCost, right: BinanceEndpointCost): number {
  return compareText(left.rateKind, right.rateKind)
    || compareText(left.scopeKind, right.scopeKind)
    || compareText(left.claimInterval, right.claimInterval)
    || compareText(left.condition, right.condition)
    || compareText(left.sourceId, right.sourceId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function quoteInputFrom(record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    contractId: record.contractId,
    product: record.product,
    environment: record.environment,
  });
}

/**
 * Resolves endpoint charges only from the accepted L02 matrix. Conditional
 * alternatives always use the maximum accepted documentary cost. L03 has no
 * request-bound condition-proof object, so a caller-authored label can never
 * lower the pre-send charge.
 */
export function quoteVerifiedEndpointCosts(input: unknown): BinanceEndpointCostQuote {
  const record = exactRecord(
    input,
    ['contractId', 'product', 'environment'],
    ['contractId', 'product', 'environment'],
    'endpoint cost quote input',
  );
  const contract = contractFor(record.contractId, record.product, record.environment);
  if (contract.rateLimit.state !== 'VERIFIED' || contract.rateLimit.claims.length === 0) {
    throw new RangeError('L02 endpoint rate cost is not VERIFIED');
  }
  const groups = new Map<string, typeof contract.rateLimit.claims>();
  for (const claim of contract.rateLimit.claims) {
    const key = `${claim.kind}\u0000${claim.scope}\u0000${claim.interval}`;
    const current = groups.get(key) ?? [];
    groups.set(key, [...current, claim]);
  }

  const costs: BinanceEndpointCost[] = [];
  for (const claims of groups.values()) {
    for (const claim of claims.filter((candidate) => candidate.condition === 'ALWAYS')) {
      costs.push({
        sourceId: claim.sourceId,
        rateKind: claim.kind,
        scopeKind: claim.scope,
        claimInterval: claim.interval,
        condition: claim.condition,
        endpointCost: claim.value,
      });
    }
    const conditional = claims.filter((candidate) => candidate.condition !== 'ALWAYS');
    if (conditional.length === 0) continue;
    const selected = [...conditional].sort((left, right) => (
      right.value - left.value || compareText(left.condition, right.condition)
    ))[0];
    if (!selected) throw new Error('verified conditional cost group is empty');
    costs.push({
      sourceId: selected.sourceId,
      rateKind: selected.kind,
      scopeKind: selected.scope,
      claimInterval: selected.interval,
      condition: selected.condition,
      endpointCost: selected.value,
    });
  }
  costs.sort(compareCosts);
  return deepFreeze({
    contractId: contract.id,
    product: contract.product,
    environment: contract.environment,
    matrixContentSha256: BINANCE_L03_RATE_MATRIX_SHA256,
    costs,
  });
}

export function createRateBudgetState(): BinanceRateBudgetState {
  return deepFreeze({
    schema: BINANCE_RATE_BUDGET_SCHEMA,
    sequence: 0,
    lastEventAtMs: null,
    reservations: [],
    headerEvents: [],
    incidents: [],
  });
}

function assertStateKey(value: unknown): asserts value is BinanceRateStateKey {
  const record = exactRecord(
    value,
    ['product', 'environment', 'contractId', 'scopeKind', 'scopeHandle', 'rateKind', 'interval', 'condition'],
    ['product', 'environment', 'contractId', 'scopeKind', 'scopeHandle', 'rateKind', 'interval', 'condition'],
    'rate state key',
  );
  oneOf(record.product, PRODUCTS, 'rate key product');
  oneOf(record.environment, ENVIRONMENTS, 'rate key environment');
  boundedIdentifier(record.contractId, 'rate key contractId');
  const scope = oneOf(record.scopeKind, SCOPE_KINDS, 'rate key scope');
  if (scope === 'UNKNOWN') throw new TypeError('rate key scope cannot be UNKNOWN');
  boundedIdentifier(record.scopeHandle, 'rate key scope handle');
  oneOf(record.rateKind, RATE_KINDS, 'rate key kind');
  oneOf(record.interval, WINDOW_INTERVALS, 'rate key interval');
  oneOf(record.condition, CONDITIONS, 'rate key condition');
}

function assertExactWindow(
  interval: BinanceRateWindowInterval,
  startValue: unknown,
  endValue: unknown,
  label: string,
): Readonly<{ start: number; end: number }> {
  const start = safeInteger(startValue, `${label} start`);
  const end = safeInteger(endValue, `${label} end`);
  const duration = INTERVAL_MS[interval];
  if (end - start !== duration || start % duration !== 0) {
    throw new TypeError(`${label} is not an aligned exact interval`);
  }
  return Object.freeze({ start, end });
}

function assertReservationEvent(value: unknown, stateSequence: number, lastEventAtMs: number | null): void {
  const record = exactRecord(
    value,
    ['key', 'sourceId', 'claimInterval', 'endpointCost', 'capacity', 'windowStartedAtMs', 'windowEndsAtMs', 'reservedAtMs', 'sequence'],
    ['key', 'sourceId', 'claimInterval', 'endpointCost', 'capacity', 'windowStartedAtMs', 'windowEndsAtMs', 'reservedAtMs', 'sequence'],
    'rate reservation event',
  );
  const eventKey = record.key;
  assertStateKey(eventKey);
  boundedIdentifier(record.sourceId, 'rate sourceId');
  oneOf(record.claimInterval, CLAIM_INTERVALS, 'rate claim interval');
  safeInteger(record.endpointCost, 'endpoint cost');
  safeInteger(record.capacity, 'event capacity', 1);
  const window = assertExactWindow(eventKey.interval, record.windowStartedAtMs, record.windowEndsAtMs, 'reservation window');
  const atMs = safeInteger(record.reservedAtMs, 'reservation event time');
  const sequence = safeInteger(record.sequence, 'reservation event sequence', 1);
  const quote = quoteVerifiedEndpointCosts({
    contractId: eventKey.contractId,
    product: eventKey.product,
    environment: eventKey.environment,
  });
  const exactCost = quote.costs.some((cost) => (
    cost.sourceId === record.sourceId
    && cost.rateKind === eventKey.rateKind
    && cost.scopeKind === eventKey.scopeKind
    && cost.claimInterval === record.claimInterval
    && cost.condition === eventKey.condition
    && cost.endpointCost === record.endpointCost
    && (cost.claimInterval === 'REQUEST' || cost.claimInterval === eventKey.interval)
  ));
  if (atMs < window.start || atMs >= window.end || sequence > stateSequence
    || lastEventAtMs === null || atMs > lastEventAtMs || !exactCost) {
    throw new TypeError('rate reservation event is inconsistent with state');
  }
}

function assertHeaderEvent(value: unknown, stateSequence: number, lastEventAtMs: number | null): void {
  const record = exactRecord(
    value,
    ['key', 'used', 'capacity', 'windowStartedAtMs', 'windowEndsAtMs', 'observedAtMs', 'sequence'],
    ['key', 'used', 'capacity', 'windowStartedAtMs', 'windowEndsAtMs', 'observedAtMs', 'sequence'],
    'rate header event',
  );
  const eventKey = record.key;
  assertStateKey(eventKey);
  safeInteger(record.used, 'observed rate use');
  safeInteger(record.capacity, 'header event capacity', 1);
  const window = assertExactWindow(eventKey.interval, record.windowStartedAtMs, record.windowEndsAtMs, 'header window');
  const atMs = safeInteger(record.observedAtMs, 'header observation time');
  const sequence = safeInteger(record.sequence, 'header event sequence', 1);
  const quote = quoteVerifiedEndpointCosts({
    contractId: eventKey.contractId,
    product: eventKey.product,
    environment: eventKey.environment,
  });
  const exactDimension = quote.costs.some((cost) => (
    cost.rateKind === eventKey.rateKind
    && cost.scopeKind === eventKey.scopeKind
    && cost.condition === eventKey.condition
    && (cost.claimInterval === 'REQUEST' || cost.claimInterval === eventKey.interval)
  ));
  if (atMs < window.start || atMs >= window.end || sequence > stateSequence
    || lastEventAtMs === null || atMs > lastEventAtMs || !exactDimension
    || (eventKey.rateKind === 'REQUEST_WEIGHT' && eventKey.scopeKind !== 'IP')
    || (eventKey.rateKind === 'ORDER_COUNT' && eventKey.scopeKind !== 'ACCOUNT')) {
    throw new TypeError('rate header event is inconsistent with state');
  }
}

function assertIncident(value: unknown, stateSequence: number, lastEventAtMs: number | null): void {
  const record = exactRecord(
    value,
    ['key', 'httpStatus', 'status', 'openedAtMs', 'updatedAtMs', 'sequence', 'nextSafeAtMs'],
    ['key', 'httpStatus', 'status', 'openedAtMs', 'updatedAtMs', 'sequence', 'nextSafeAtMs'],
    'rate incident',
  );
  const key = exactRecord(
    record.key,
    ['product', 'environment', 'contractId', 'scopeKind', 'scopeHandle'],
    ['product', 'environment', 'contractId', 'scopeKind', 'scopeHandle'],
    'rate incident key',
  );
  const contract = contractFor(key.contractId, key.product, key.environment);
  const scopeKind = oneOf(key.scopeKind, SCOPE_KINDS, 'incident scope');
  if (scopeKind === 'UNKNOWN') throw new TypeError('incident scope cannot be UNKNOWN');
  boundedIdentifier(key.scopeHandle, 'incident scope handle');
  const quote = quoteVerifiedEndpointCosts({
    contractId: contract.id,
    product: contract.product,
    environment: contract.environment,
  });
  if (!quote.costs.some((cost) => cost.scopeKind === scopeKind)) {
    throw new TypeError('incident scope is not an exact L02 contract dimension');
  }
  if (record.httpStatus !== 418 && record.httpStatus !== 429) throw new TypeError('incident HTTP status is invalid');
  const status = oneOf(record.status, INCIDENT_STATUSES, 'rate incident status');
  const openedAtMs = safeInteger(record.openedAtMs, 'incident opened time');
  const updatedAtMs = safeInteger(record.updatedAtMs, 'incident updated time');
  const sequence = safeInteger(record.sequence, 'incident sequence', 1);
  if (record.nextSafeAtMs !== null) safeInteger(record.nextSafeAtMs, 'incident next-safe time');
  const nextSafeDeltaMs = record.nextSafeAtMs === null
    ? null
    : (record.nextSafeAtMs as number) - updatedAtMs;
  if (updatedAtMs < openedAtMs || lastEventAtMs === null || updatedAtMs > lastEventAtMs
    || (status === 'OPEN_MANUAL' && record.nextSafeAtMs !== null)
    || (nextSafeDeltaMs !== null && (
      contract.product !== 'SPOT'
      || record.httpStatus !== 429
      || status !== 'COOLDOWN'
      || nextSafeDeltaMs < 1_000
      || nextSafeDeltaMs > 259_200_000
    ))
    || (record.httpStatus === 418 && status !== 'OPEN_MANUAL')
    || sequence > stateSequence) {
    throw new TypeError('rate incident is inconsistent with state');
  }
}

function assertState(value: unknown): asserts value is BinanceRateBudgetState {
  const record = exactRecord(
    value,
    ['schema', 'sequence', 'lastEventAtMs', 'reservations', 'headerEvents', 'incidents'],
    ['schema', 'sequence', 'lastEventAtMs', 'reservations', 'headerEvents', 'incidents'],
    'rate budget state',
  );
  if (!isDeeplyFrozenData(value)) throw new TypeError('rate budget state must be a deeply frozen data graph');
  if (record.schema !== BINANCE_RATE_BUDGET_SCHEMA) throw new TypeError('rate budget state schema mismatch');
  const sequence = safeInteger(record.sequence, 'rate budget state sequence');
  const lastEventAtMs = record.lastEventAtMs === null
    ? null
    : safeInteger(record.lastEventAtMs, 'rate budget last event time');
  const reservations = exactArray(record.reservations, 'rate budget reservations', BINANCE_RATE_BUDGET_MAX_EVENTS);
  const headerEvents = exactArray(record.headerEvents, 'rate budget header events', BINANCE_RATE_BUDGET_MAX_EVENTS);
  const incidents = exactArray(record.incidents, 'rate budget incidents', BINANCE_RATE_BUDGET_MAX_INCIDENTS);
  if (reservations.length + headerEvents.length > BINANCE_RATE_BUDGET_MAX_EVENTS
    || (sequence === 0) !== (lastEventAtMs === null)
    || (sequence === 0 && (reservations.length !== 0 || headerEvents.length !== 0 || incidents.length !== 0))) {
    throw new TypeError('rate budget state counters are inconsistent');
  }
  for (const event of reservations) assertReservationEvent(event, sequence, lastEventAtMs);
  for (const event of headerEvents) assertHeaderEvent(event, sequence, lastEventAtMs);
  for (const incident of incidents) assertIncident(incident, sequence, lastEventAtMs);
  const sequenceTimes = [
    ...reservations.map((event) => ({ sequence: (event as BinanceRateReservationEvent).sequence, atMs: (event as BinanceRateReservationEvent).reservedAtMs })),
    ...headerEvents.map((event) => ({ sequence: (event as BinanceRateHeaderEvent).sequence, atMs: (event as BinanceRateHeaderEvent).observedAtMs })),
    ...incidents.map((incident) => ({ sequence: (incident as BinanceRateIncident).sequence, atMs: (incident as BinanceRateIncident).updatedAtMs })),
  ];
  if (sequence > 0 && sequenceTimes.length === 0) throw new TypeError('nonzero rate state cannot be empty');
  if (sequenceTimes.length > 0) {
    const maximumSequence = Math.max(...sequenceTimes.map((event) => event.sequence));
    const maximumTime = Math.max(...sequenceTimes.map((event) => event.atMs));
    if (maximumSequence !== sequence || maximumTime !== lastEventAtMs) {
      throw new TypeError('rate state sequence or last event time is not bound to an event');
    }
    const bySequence = new Map<number, number>();
    for (const event of sequenceTimes) {
      const existing = bySequence.get(event.sequence);
      if (existing !== undefined && existing !== event.atMs) {
        throw new TypeError('one rate action sequence cannot carry multiple times');
      }
      bySequence.set(event.sequence, event.atMs);
    }
    let priorTime = -1;
    for (const actionSequence of [...bySequence.keys()].sort((left, right) => left - right)) {
      const actionTime = bySequence.get(actionSequence) as number;
      if (actionTime < priorTime) throw new TypeError('rate action sequence time regressed');
      priorTime = actionTime;
    }
  }
  const orderedHeaders = (headerEvents as readonly BinanceRateHeaderEvent[])
    .slice()
    .sort((left, right) => left.sequence - right.sequence);
  for (let index = 0; index < orderedHeaders.length; index += 1) {
    const current = orderedHeaders[index] as BinanceRateHeaderEvent;
    const previous = orderedHeaders
      .slice(0, index)
      .filter((candidate) => matchingWindow(
        current.key,
        current.windowStartedAtMs,
        current.windowEndsAtMs,
        candidate,
      ))
      .at(-1);
    if (previous === undefined) continue;
    if (previous.sequence === current.sequence) {
      throw new TypeError('one rate action cannot contain duplicate shared header counters');
    }
    const interveningCost = (reservations as readonly BinanceRateReservationEvent[])
      .filter((event) => matchingWindow(
        current.key,
        current.windowStartedAtMs,
        current.windowEndsAtMs,
        event,
      ) && event.sequence > previous.sequence && event.sequence < current.sequence)
      .reduce((sum, event) => sum + event.endpointCost, 0);
    if (!Number.isSafeInteger(interveningCost)
      || current.used < previous.used + interveningCost) {
      throw new TypeError('rate header history regressed below prior effective usage');
    }
  }
}

function scopeHandles(value: unknown): Readonly<Partial<Record<BinanceRateScope, string>>> {
  const record = exactRecord(
    value,
    ['IP', 'UID', 'ACCOUNT', 'CONNECTION'],
    [],
    'rate scope handles',
  );
  const result: Partial<Record<BinanceRateScope, string>> = {};
  for (const [scope, handle] of Object.entries(record)) {
    result[scope as BinanceRateScope] = boundedIdentifier(handle, `${scope} scope handle`);
  }
  return deepFreeze(result);
}

function readCapacity(value: unknown): BinanceRateWindowCapacity {
  const record = exactRecord(
    value,
    ['product', 'environment', 'scopeKind', 'scopeHandle', 'rateKind', 'interval', 'capacity', 'windowStartedAtMs', 'windowEndsAtMs'],
    ['product', 'environment', 'scopeKind', 'scopeHandle', 'rateKind', 'interval', 'capacity', 'windowStartedAtMs', 'windowEndsAtMs'],
    'rate window capacity',
  );
  const product = oneOf(record.product, PRODUCTS, 'capacity product');
  const environment = oneOf(record.environment, ENVIRONMENTS, 'capacity environment');
  const scopeKind = oneOf(record.scopeKind, SCOPE_KINDS, 'capacity scope');
  if (scopeKind === 'UNKNOWN') throw new TypeError('capacity scope cannot be UNKNOWN');
  const scopeHandle = boundedIdentifier(record.scopeHandle, 'capacity scope handle');
  const rateKind = oneOf(record.rateKind, RATE_KINDS, 'capacity rate kind');
  const interval = oneOf(record.interval, WINDOW_INTERVALS, 'capacity interval');
  const capacity = safeInteger(record.capacity, 'rate capacity', 1);
  const windowStartedAtMs = safeInteger(record.windowStartedAtMs, 'capacity window start');
  const windowEndsAtMs = safeInteger(record.windowEndsAtMs, 'capacity window end');
  const duration = INTERVAL_MS[interval];
  if (windowEndsAtMs - windowStartedAtMs !== duration
    || windowStartedAtMs % duration !== 0) {
    throw new TypeError('capacity window must be an aligned exact interval');
  }
  return deepFreeze({ product, environment, scopeKind, scopeHandle, rateKind, interval, capacity, windowStartedAtMs, windowEndsAtMs });
}

function capacities(value: unknown): readonly BinanceRateWindowCapacity[] {
  const input = exactArray(value, 'rate capacities', 32);
  const parsed = input.map(readCapacity);
  for (let left = 0; left < parsed.length; left += 1) {
    for (let right = left + 1; right < parsed.length; right += 1) {
      if (sameCapacityDimension(parsed[left] as BinanceRateWindowCapacity, parsed[right] as BinanceRateWindowCapacity)) {
        throw new TypeError('rate capacities cannot duplicate a dimension');
      }
    }
  }
  return deepFreeze(parsed);
}

function sameCapacityDimension(left: BinanceRateWindowCapacity, right: BinanceRateWindowCapacity): boolean {
  return left.product === right.product
    && left.environment === right.environment
    && left.scopeKind === right.scopeKind
    && left.scopeHandle === right.scopeHandle
    && left.rateKind === right.rateKind
    && left.interval === right.interval
    && left.windowStartedAtMs === right.windowStartedAtMs
    && left.windowEndsAtMs === right.windowEndsAtMs;
}

function sameSharedKey(left: BinanceRateStateKey, right: BinanceRateStateKey): boolean {
  return left.product === right.product
    && left.environment === right.environment
    && left.scopeKind === right.scopeKind
    && left.scopeHandle === right.scopeHandle
    && left.rateKind === right.rateKind
    && left.interval === right.interval;
}

interface ExpandedCharge {
  readonly key: BinanceRateStateKey;
  readonly sourceId: string;
  readonly claimInterval: BinanceRateInterval;
  readonly endpointCost: number;
  readonly capacity: BinanceRateWindowCapacity;
}

function expandQuote(
  quote: BinanceEndpointCostQuote,
  handles: Readonly<Partial<Record<BinanceRateScope, string>>>,
  suppliedCapacities: readonly BinanceRateWindowCapacity[],
  atMs: number,
): Readonly<{ charges: readonly ExpandedCharge[]; reason: 'OK' | 'CAPACITY_UNKNOWN' | 'CAPACITY_WINDOW_MISMATCH' }> {
  const charges: ExpandedCharge[] = [];
  for (const cost of quote.costs) {
    if (cost.scopeKind === 'UNKNOWN') return Object.freeze({ charges: [], reason: 'CAPACITY_UNKNOWN' });
    const handle = handles[cost.scopeKind];
    if (handle === undefined) return Object.freeze({ charges: [], reason: 'CAPACITY_UNKNOWN' });
    const matches = suppliedCapacities.filter((capacity) => (
      capacity.product === quote.product
      && capacity.environment === quote.environment
      && capacity.scopeKind === cost.scopeKind
      && capacity.scopeHandle === handle
      && capacity.rateKind === cost.rateKind
      && (cost.claimInterval === 'REQUEST' || capacity.interval === cost.claimInterval)
    ));
    if (matches.length === 0) return Object.freeze({ charges: [], reason: 'CAPACITY_UNKNOWN' });
    for (const capacity of matches) {
      if (atMs < capacity.windowStartedAtMs || atMs >= capacity.windowEndsAtMs) {
        return Object.freeze({ charges: [], reason: 'CAPACITY_WINDOW_MISMATCH' });
      }
      charges.push(deepFreeze({
        key: {
          product: quote.product,
          environment: quote.environment,
          contractId: quote.contractId,
          scopeKind: cost.scopeKind,
          scopeHandle: handle,
          rateKind: cost.rateKind,
          interval: capacity.interval,
          condition: cost.condition,
        },
        sourceId: cost.sourceId,
        claimInterval: cost.claimInterval,
        endpointCost: cost.endpointCost,
        capacity,
      }));
    }
  }
  return deepFreeze({ charges, reason: 'OK' });
}

function matchingWindow(
  key: BinanceRateStateKey,
  windowStartedAtMs: number,
  windowEndsAtMs: number,
  event: BinanceRateReservationEvent | BinanceRateHeaderEvent,
): boolean {
  return sameSharedKey(key, event.key)
    && event.windowStartedAtMs === windowStartedAtMs
    && event.windowEndsAtMs === windowEndsAtMs;
}

function effectiveUsed(
  state: BinanceRateBudgetState,
  key: BinanceRateStateKey,
  capacity: BinanceRateWindowCapacity,
): number | null {
  const header = [...state.headerEvents]
    .filter((event) => matchingWindow(key, capacity.windowStartedAtMs, capacity.windowEndsAtMs, event))
    .sort((left, right) => right.sequence - left.sequence)[0];
  if (header === undefined) return null;
  const baseline = header.used;
  const afterSequence = header.sequence;
  const local = state.reservations
    .filter((event) => matchingWindow(key, capacity.windowStartedAtMs, capacity.windowEndsAtMs, event)
      && event.sequence > afterSequence)
    .reduce((sum, event) => sum + event.endpointCost, 0);
  const result = baseline + local;
  return Number.isSafeInteger(result) ? result : Number.MAX_SAFE_INTEGER;
}

function capacityConflicts(
  state: BinanceRateBudgetState,
  key: BinanceRateStateKey,
  capacity: BinanceRateWindowCapacity,
): boolean {
  return [...state.reservations, ...state.headerEvents].some((event) => (
    matchingWindow(key, capacity.windowStartedAtMs, capacity.windowEndsAtMs, event)
    && event.capacity !== capacity.capacity
  ));
}

function sameIncidentScope(left: BinanceRateIncidentKey, right: BinanceRateIncidentKey): boolean {
  return left.product === right.product
    && left.environment === right.environment
    && left.scopeKind === right.scopeKind
    && left.scopeHandle === right.scopeHandle;
}

function incidentKeys(
  quote: BinanceEndpointCostQuote,
  handles: Readonly<Partial<Record<BinanceRateScope, string>>>,
): readonly BinanceRateIncidentKey[] {
  const result: BinanceRateIncidentKey[] = [];
  for (const cost of quote.costs) {
    if (cost.scopeKind === 'UNKNOWN') throw new TypeError('incident scope cannot be UNKNOWN');
    const scopeHandle = handles[cost.scopeKind];
    if (scopeHandle === undefined) throw new TypeError('every incident scope requires an opaque handle');
    const key = deepFreeze({
      product: quote.product,
      environment: quote.environment,
      contractId: quote.contractId,
      scopeKind: cost.scopeKind,
      scopeHandle,
    });
    if (!result.some((candidate) => sameIncidentScope(candidate, key))) result.push(key);
  }
  return deepFreeze(result);
}

function sharedIncident(
  state: BinanceRateBudgetState,
  key: BinanceRateIncidentKey,
  atMs: number,
): Readonly<{ blocked: boolean; manual: boolean; nextSafeAtMs: number | null }> {
  const matching = state.incidents.filter((incident) => sameIncidentScope(incident.key, key));
  if (matching.some((incident) => incident.status === 'OPEN_MANUAL')) {
    return Object.freeze({ blocked: true, manual: true, nextSafeAtMs: null });
  }
  if (matching.some((incident) => incident.nextSafeAtMs === null)) {
    return Object.freeze({ blocked: true, manual: false, nextSafeAtMs: null });
  }
  const active = matching
    .map((incident) => incident.nextSafeAtMs)
    .filter((until): until is number => until !== null && until > atMs);
  return Object.freeze({
    blocked: active.length !== 0,
    manual: false,
    nextSafeAtMs: active.length === 0 ? null : Math.max(...active),
  });
}

function prunedStateParts(state: BinanceRateBudgetState, atMs: number): Readonly<{
  reservations: readonly BinanceRateReservationEvent[];
  headerEvents: readonly BinanceRateHeaderEvent[];
  incidents: readonly BinanceRateIncident[];
}> {
  return Object.freeze({
    reservations: state.reservations.filter((event) => event.windowEndsAtMs > atMs),
    headerEvents: state.headerEvents.filter((event) => event.windowEndsAtMs > atMs),
    incidents: state.incidents.filter((incident) => (
      incident.status === 'OPEN_MANUAL'
      || incident.nextSafeAtMs === null
      || incident.nextSafeAtMs > atMs
    )),
  });
}

export function reserveRateBudget(stateValue: unknown, input: unknown): BinanceRateReservationDecision {
  assertState(stateValue);
  const state = stateValue;
  const record = exactRecord(
    input,
    ['contractId', 'product', 'environment', 'scopeHandles', 'capacities', 'atMs'],
    ['contractId', 'product', 'environment', 'scopeHandles', 'capacities', 'atMs'],
    'rate reservation input',
  );
  const quote = quoteVerifiedEndpointCosts(quoteInputFrom(record));
  const atMs = safeInteger(record.atMs, 'reservation time');
  if (state.lastEventAtMs !== null && atMs < state.lastEventAtMs) {
    return deepFreeze({ allowed: false, reason: 'CLOCK_REGRESSION', nextSafeAtMs: null, quote, state });
  }
  const handles = scopeHandles(record.scopeHandles);
  for (const incidentKey of incidentKeys(quote, handles)) {
    const incident = sharedIncident(state, incidentKey, atMs);
    if (incident.blocked) {
      return deepFreeze({
        allowed: false,
        reason: incident.manual ? 'CIRCUIT_OPEN' : 'COOLDOWN',
        nextSafeAtMs: incident.nextSafeAtMs,
        quote,
        state,
      });
    }
  }
  const expanded = expandQuote(quote, handles, capacities(record.capacities), atMs);
  if (expanded.reason !== 'OK') {
    return deepFreeze({ allowed: false, reason: expanded.reason, nextSafeAtMs: null, quote, state });
  }

  let blockedUntil: number | null = null;
  for (const charge of expanded.charges) {
    if (capacityConflicts(state, charge.key, charge.capacity)) {
      return deepFreeze({ allowed: false, reason: 'CAPACITY_UNKNOWN', nextSafeAtMs: null, quote, state });
    }
  }

  const dimensions: Array<{ charge: ExpandedCharge; increment: number }> = [];
  for (const charge of expanded.charges) {
    const current = dimensions.find((candidate) => (
      sameSharedKey(candidate.charge.key, charge.key)
      && sameCapacityDimension(candidate.charge.capacity, charge.capacity)
    ));
    if (current) current.increment += charge.endpointCost;
    else dimensions.push({ charge, increment: charge.endpointCost });
  }
  for (const dimension of dimensions) {
    const used = effectiveUsed(state, dimension.charge.key, dimension.charge.capacity);
    if (used === null) {
      return deepFreeze({ allowed: false, reason: 'USAGE_UNKNOWN', nextSafeAtMs: null, quote, state });
    }
    if (dimension.increment > dimension.charge.capacity.capacity
      || used > dimension.charge.capacity.capacity - dimension.increment) {
      blockedUntil = blockedUntil === null
        ? dimension.charge.capacity.windowEndsAtMs
        : Math.max(blockedUntil, dimension.charge.capacity.windowEndsAtMs);
    }
  }
  if (blockedUntil !== null) {
    return deepFreeze({ allowed: false, reason: 'BUDGET_EXHAUSTED', nextSafeAtMs: blockedUntil, quote, state });
  }

  const pruned = prunedStateParts(state, atMs);
  if (pruned.reservations.length + pruned.headerEvents.length + expanded.charges.length > BINANCE_RATE_BUDGET_MAX_EVENTS
    || state.sequence === Number.MAX_SAFE_INTEGER) {
    return deepFreeze({ allowed: false, reason: 'STATE_BOUND', nextSafeAtMs: null, quote, state });
  }
  const sequence = state.sequence + 1;
  const additions = expanded.charges.map((charge): BinanceRateReservationEvent => deepFreeze({
    key: charge.key,
    sourceId: charge.sourceId,
    claimInterval: charge.claimInterval,
    endpointCost: charge.endpointCost,
    capacity: charge.capacity.capacity,
    windowStartedAtMs: charge.capacity.windowStartedAtMs,
    windowEndsAtMs: charge.capacity.windowEndsAtMs,
    reservedAtMs: atMs,
    sequence,
  }));
  const nextState = deepFreeze({
    schema: BINANCE_RATE_BUDGET_SCHEMA,
    sequence,
    lastEventAtMs: atMs,
    reservations: [...pruned.reservations, ...additions],
    headerEvents: pruned.headerEvents,
    incidents: pruned.incidents,
  });
  return deepFreeze({ allowed: true, reason: 'RESERVED', nextSafeAtMs: null, quote, state: nextState });
}

function headerInteger(value: string): number | null {
  if (!/^(0|[1-9]\d{0,14})$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function intervalFromHeaderToken(token: string): BinanceRateWindowInterval | null {
  switch (token.toLowerCase()) {
    case '1s': return 'SECOND';
    case '10s': return 'TEN_SECONDS';
    case '1m': return 'MINUTE';
    case '5m': return 'FIVE_MINUTES';
    case '1d': return 'DAY';
    default: return null;
  }
}

/** Parses only closed, canonical Binance interval-counter headers. */
export function parseCanonicalBinanceRateHeaders(
  productValue: unknown,
  headersValue: unknown,
): ParsedCanonicalBinanceRateHeaders {
  const product = oneOf(productValue, PRODUCTS, 'header product');
  if (typeof headersValue !== 'object' || headersValue === null
    || utilTypes.isProxy(headersValue) || Array.isArray(headersValue)) {
    throw new TypeError('rate response headers must be a plain object');
  }
  const prototype = Object.getPrototypeOf(headersValue);
  if (prototype !== Object.prototype && prototype !== null
    || Object.getOwnPropertySymbols(headersValue).length !== 0) {
    throw new TypeError('rate response headers must be a plain object');
  }
  const descriptors = Object.getOwnPropertyDescriptors(headersValue as object);
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string' || name.length < 1 || name.length > 128
      || descriptor.value.length > 128) {
      throw new TypeError('rate response headers must contain bounded string data properties');
    }
  }
  return parseCanonicalBinanceRateHeadersUnsafe(product, Object.fromEntries(
    Object.entries(descriptors).map(([name, descriptor]) => [name, descriptor.value]),
  ));
}

function parseCanonicalBinanceRateHeadersUnsafe(
  product: BinanceProduct,
  raw: Record<string, string>,
): ParsedCanonicalBinanceRateHeaders {
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Object.keys(descriptors).length > 128) throw new TypeError('rate response headers exceed the count bound');
  const observations: CanonicalBinanceRateHeaderObservation[] = [];
  let retryAfterRaw: string | null = null;
  const logicalNames = new Set<string>();
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
      || typeof descriptor.value !== 'string' || name.length < 1 || name.length > 128
      || descriptor.value.length > 128) {
      throw new TypeError('rate response headers must contain bounded string data properties');
    }
    const lower = name.toLowerCase();
    if (logicalNames.has(lower)) throw new TypeError('rate response headers contain a case-duplicate field');
    logicalNames.add(lower);
    if (lower === 'retry-after') { retryAfterRaw = descriptor.value; continue; }
    const match = /^(x-mbx-used-weight|x-mbx-order-count)-([0-9]+[a-z])$/.exec(lower);
    if (match === null) {
      if (/^x-mbx-(?:used-weight|order-count)/.test(lower)) {
        throw new TypeError('rate response header name is not canonical');
      }
      continue;
    }
    const interval = intervalFromHeaderToken(match[2] as string);
    const used = headerInteger(descriptor.value);
    if (interval === null || used === null) throw new TypeError('rate response header is not canonical');
    const rateKind = (match[1] as string).endsWith('used-weight') ? 'REQUEST_WEIGHT' : 'ORDER_COUNT';
    const scopeKind = rateKind === 'REQUEST_WEIGHT' ? 'IP' : 'ACCOUNT';
    if (observations.some((observation) => observation.rateKind === rateKind && observation.interval === interval)) {
      throw new TypeError('rate response headers duplicate a logical interval counter');
    }
    observations.push(deepFreeze({ rateKind, scopeKind, interval, used }));
  }
  observations.sort((left, right) => compareText(left.rateKind, right.rateKind)
    || compareText(left.interval, right.interval));
  if (retryAfterRaw === null || !/^[1-9]\d{0,5}$/.test(retryAfterRaw)) {
    return deepFreeze({ observations, retryAfterTruth: 'UNKNOWN', retryAfterDeltaMs: null });
  }
  const seconds = Number(retryAfterRaw);
  if (!Number.isSafeInteger(seconds) || seconds > 259_200) {
    return deepFreeze({ observations, retryAfterTruth: 'UNKNOWN', retryAfterDeltaMs: null });
  }
  return product === 'SPOT'
    ? deepFreeze({ observations, retryAfterTruth: 'VERIFIED', retryAfterDeltaMs: seconds * 1_000 })
    : deepFreeze({ observations, retryAfterTruth: 'UNPROVED_FOR_PRODUCT', retryAfterDeltaMs: null });
}

export function parseCanonicalRateHeaders(productValue: unknown, headersValue: unknown): ParsedCanonicalBinanceRateHeaders {
  return parseCanonicalBinanceRateHeaders(productValue, headersValue);
}

function uniqueExpandedDimensions(charges: readonly ExpandedCharge[]): readonly ExpandedCharge[] {
  const result: ExpandedCharge[] = [];
  for (const charge of charges) {
    if (!result.some((candidate) => sameSharedKey(candidate.key, charge.key)
      && sameCapacityDimension(candidate.capacity, charge.capacity))) {
      result.push(charge);
    }
  }
  return result;
}

function sameFullIncident(left: BinanceRateIncidentKey, right: BinanceRateIncidentKey): boolean {
  return sameIncidentScope(left, right) && left.contractId === right.contractId;
}

function incidentUpdate(
  existing: readonly BinanceRateIncident[],
  key: BinanceRateIncidentKey,
  httpStatus: 418 | 429,
  atMs: number,
  sequence: number,
  parsed: ParsedCanonicalBinanceRateHeaders,
): BinanceRateIncident {
  const shared = existing.filter((incident) => sameIncidentScope(incident.key, key));
  const current = existing.find((incident) => sameFullIncident(incident.key, key));
  const openedAtMs = current?.openedAtMs ?? atMs;
  if (httpStatus === 418 || shared.some((incident) => incident.status === 'OPEN_MANUAL')) {
    return deepFreeze({ key, httpStatus, status: 'OPEN_MANUAL', openedAtMs, updatedAtMs: atMs, sequence, nextSafeAtMs: null });
  }
  let proposed: number | null = null;
  if (parsed.retryAfterTruth === 'VERIFIED' && parsed.retryAfterDeltaMs !== null
    && atMs <= Number.MAX_SAFE_INTEGER - parsed.retryAfterDeltaMs) {
    proposed = atMs + parsed.retryAfterDeltaMs;
  }
  if (shared.some((incident) => incident.nextSafeAtMs === null)) proposed = null;
  else {
    const prior = shared
      .map((incident) => incident.nextSafeAtMs)
      .filter((value): value is number => value !== null);
    if (prior.length !== 0 && proposed !== null) proposed = Math.max(proposed, ...prior);
  }
  return deepFreeze({ key, httpStatus, status: 'COOLDOWN', openedAtMs, updatedAtMs: atMs, sequence, nextSafeAtMs: proposed });
}

export function observeRateResponse(stateValue: unknown, input: unknown): BinanceRateObservationDecision {
  assertState(stateValue);
  const state = stateValue;
  const record = exactRecord(
    input,
    ['contractId', 'product', 'environment', 'scopeHandles', 'capacities', 'atMs', 'status', 'headers'],
    ['contractId', 'product', 'environment', 'scopeHandles', 'atMs', 'status', 'headers'],
    'rate response observation input',
  );
  const quote = quoteVerifiedEndpointCosts(quoteInputFrom(record));
  const atMs = safeInteger(record.atMs, 'response observation time');
  const status = safeInteger(record.status, 'HTTP status', 100);
  if (status > 599) throw new TypeError('HTTP status must be <= 599');
  const parsed = parseCanonicalRateHeaders(quote.product, record.headers);
  if (state.lastEventAtMs !== null && atMs < state.lastEventAtMs) {
    return deepFreeze({
      accepted: false,
      reason: 'CLOCK_REGRESSION',
      headerTruth: 'UNKNOWN',
      retryAfterTruth: parsed.retryAfterTruth,
      nextSafeAtMs: null,
      state,
    });
  }
  if (state.sequence === Number.MAX_SAFE_INTEGER) {
    return deepFreeze({ accepted: false, reason: 'STATE_BOUND', headerTruth: 'UNKNOWN', retryAfterTruth: parsed.retryAfterTruth, nextSafeAtMs: null, state });
  }
  const sequence = state.sequence + 1;
  const handles = scopeHandles(record.scopeHandles);
  const limitIncident = status === 418 || status === 429;
  let incidents = [...prunedStateParts(state, atMs).incidents];
  if (limitIncident) {
    for (const key of incidentKeys(quote, handles)) {
      const update = incidentUpdate(incidents, key, status as 418 | 429, atMs, sequence, parsed);
      incidents = incidents.filter((incident) => !sameFullIncident(incident.key, update.key));
      incidents.push(update);
    }
  }

  const suppliedCapacities = record.capacities === undefined ? [] : capacities(record.capacities);
  const expanded = expandQuote(quote, handles, suppliedCapacities, atMs);
  if (expanded.reason !== 'OK') {
    if (!limitIncident) {
      return deepFreeze({
        accepted: false,
        reason: expanded.reason,
        headerTruth: 'UNKNOWN',
        retryAfterTruth: parsed.retryAfterTruth,
        nextSafeAtMs: null,
        state,
      });
    }
    if (incidents.length > BINANCE_RATE_BUDGET_MAX_INCIDENTS) {
      return deepFreeze({ accepted: false, reason: 'STATE_BOUND', headerTruth: 'UNKNOWN', retryAfterTruth: parsed.retryAfterTruth, nextSafeAtMs: null, state });
    }
    const pruned = prunedStateParts(state, atMs);
    const nextState = deepFreeze({
      schema: BINANCE_RATE_BUDGET_SCHEMA,
      sequence,
      lastEventAtMs: atMs,
      reservations: pruned.reservations,
      headerEvents: pruned.headerEvents,
      incidents,
    });
    const safeTimes = incidents
      .map((incident) => incident.nextSafeAtMs)
      .filter((value): value is number => value !== null);
    return deepFreeze({
      accepted: true,
      reason: 'INCIDENT_RECORDED',
      headerTruth: 'UNKNOWN',
      retryAfterTruth: parsed.retryAfterTruth,
      nextSafeAtMs: safeTimes.length === 0 ? null : Math.max(...safeTimes),
      state: nextState,
    });
  }
  const dimensions = uniqueExpandedDimensions(expanded.charges);
  const headerCapacityConflict = dimensions.some((charge) => capacityConflicts(state, charge.key, charge.capacity));
  if (headerCapacityConflict && !limitIncident) {
    return deepFreeze({ accepted: false, reason: 'CAPACITY_UNKNOWN', headerTruth: 'UNKNOWN', retryAfterTruth: parsed.retryAfterTruth, nextSafeAtMs: null, state });
  }
  const matched = dimensions.map((charge) => ({
    charge,
    observation: parsed.observations.find((candidate) => (
      candidate.rateKind === charge.key.rateKind
      && candidate.scopeKind === charge.key.scopeKind
      && candidate.interval === charge.key.interval
    )) ?? null,
  }));
  const regression = matched.some(({ charge, observation }) => {
    if (observation === null) return false;
    const effective = effectiveUsed(state, charge.key, charge.capacity);
    return effective !== null && observation.used < effective;
  });

  const pruned = prunedStateParts(state, atMs);
  const newHeaderEvents = regression || headerCapacityConflict ? [] : matched
    .filter((item): item is typeof item & { observation: CanonicalBinanceRateHeaderObservation } => item.observation !== null)
    .map(({ charge, observation }): BinanceRateHeaderEvent => deepFreeze({
      key: charge.key,
      used: observation.used,
      capacity: charge.capacity.capacity,
      windowStartedAtMs: charge.capacity.windowStartedAtMs,
      windowEndsAtMs: charge.capacity.windowEndsAtMs,
      observedAtMs: atMs,
      sequence,
    }));

  if (pruned.reservations.length + pruned.headerEvents.length + newHeaderEvents.length > BINANCE_RATE_BUDGET_MAX_EVENTS
    || incidents.length > BINANCE_RATE_BUDGET_MAX_INCIDENTS) {
    return deepFreeze({ accepted: false, reason: 'STATE_BOUND', headerTruth: 'UNKNOWN', retryAfterTruth: parsed.retryAfterTruth, nextSafeAtMs: null, state });
  }
  if (regression && !limitIncident) {
    return deepFreeze({ accepted: false, reason: 'HEADER_REGRESSION', headerTruth: 'UNKNOWN', retryAfterTruth: parsed.retryAfterTruth, nextSafeAtMs: null, state });
  }
  if (newHeaderEvents.length === 0 && !limitIncident) {
    return deepFreeze({ accepted: false, reason: 'USAGE_UNKNOWN', headerTruth: 'UNKNOWN', retryAfterTruth: parsed.retryAfterTruth, nextSafeAtMs: null, state });
  }
  const nextState = deepFreeze({
    schema: BINANCE_RATE_BUDGET_SCHEMA,
    sequence,
    lastEventAtMs: atMs,
    reservations: pruned.reservations,
    headerEvents: [...pruned.headerEvents, ...newHeaderEvents],
    incidents,
  });
  const knownSafeTimes = incidents
    .filter((incident) => incident.status === 'COOLDOWN')
    .map((incident) => incident.nextSafeAtMs)
    .filter((value): value is number => value !== null);
  const headerTruth = !regression && !headerCapacityConflict
    && matched.length !== 0 && matched.every((item) => item.observation !== null)
    ? 'VERIFIED'
    : 'UNKNOWN';
  return deepFreeze({
    accepted: !regression,
    reason: regression ? 'HEADER_REGRESSION' : limitIncident ? 'INCIDENT_RECORDED' : 'OBSERVED',
    headerTruth,
    retryAfterTruth: parsed.retryAfterTruth,
    nextSafeAtMs: knownSafeTimes.length === 0 ? null : Math.max(...knownSafeTimes),
    state: nextState,
  });
}

function retryNo(
  reason: Exclude<BinanceAutomaticReadRetryAdvice['reason'], 'READ_ONLY_RETRY'>,
  remainingAttempts: number,
): BinanceAutomaticReadRetryAdvice {
  return deepFreeze({ automatic: false, reason, retryAtMs: null, remainingAttempts });
}

export function adviseAutomaticReadRetry(stateValue: unknown, input: unknown): BinanceAutomaticReadRetryAdvice {
  assertState(stateValue);
  const state = stateValue;
  const record = exactRecord(
    input,
    ['contractId', 'product', 'environment', 'scopeHandles', 'atMs', 'outcome', 'attemptsUsed', 'maximumAttempts'],
    ['contractId', 'product', 'environment', 'scopeHandles', 'atMs', 'outcome', 'attemptsUsed', 'maximumAttempts'],
    'automatic read retry input',
  );
  const contract = contractFor(record.contractId, record.product, record.environment);
  const handles = scopeHandles(record.scopeHandles);
  const atMs = safeInteger(record.atMs, 'retry advice time');
  const attemptsUsed = safeInteger(record.attemptsUsed, 'attemptsUsed', 1);
  const maximumAttempts = safeInteger(record.maximumAttempts, 'maximumAttempts', 1);
  if (maximumAttempts > BINANCE_AUTOMATIC_READ_RETRY_MAXIMUM) {
    throw new RangeError('maximumAttempts exceeds the automatic retry bound');
  }
  const remaining = Math.max(0, maximumAttempts - attemptsUsed);
  const outcome = oneOf(
    record.outcome,
    READ_RETRY_OUTCOMES,
    'retry outcome',
  );
  if (contract.product === 'MARGIN') return retryNo('MARGIN_BLOCKED', remaining);
  if (contract.mutationClass === 'PRIVATE_STREAM_CONTROL') return retryNo('PRIVATE_STREAM_BLOCKED', remaining);
  if (!READ_ONLY_MUTATION_CLASSES.includes(contract.mutationClass) || contract.operation?.httpMethod !== 'GET') {
    return retryNo('MUTATION_BLOCKED', remaining);
  }
  if (outcome === 'AMBIGUOUS') return retryNo('AMBIGUOUS_BLOCKED', remaining);
  if (remaining === 0) return retryNo('ATTEMPT_LIMIT', remaining);
  if (state.lastEventAtMs !== null && atMs < state.lastEventAtMs) return retryNo('CLOCK_REGRESSION', remaining);

  const relevantIncidents = state.incidents.filter((incident) => (
    incident.key.product === contract.product
    && incident.key.environment === contract.environment
    && handles[incident.key.scopeKind] === incident.key.scopeHandle
  ));
  if (relevantIncidents.some((incident) => incident.status === 'OPEN_MANUAL' || incident.nextSafeAtMs === null)) {
    return retryNo('COOLDOWN_UNKNOWN', remaining);
  }
  const futureTimes = relevantIncidents
    .map((incident) => incident.nextSafeAtMs)
    .filter((value): value is number => value !== null && value > atMs);
  if (outcome === 'HTTP_429' && relevantIncidents.length === 0) return retryNo('COOLDOWN_UNKNOWN', remaining);

  const quote = quoteVerifiedEndpointCosts({
    contractId: contract.id,
    product: contract.product,
    environment: contract.environment,
  });
  const exactReservations = state.reservations.filter((event) => (
    event.key.contractId === contract.id
    && event.key.product === contract.product
    && event.key.environment === contract.environment
    && handles[event.key.scopeKind] === event.key.scopeHandle
    && event.windowStartedAtMs <= atMs
    && event.windowEndsAtMs > atMs
  ));
  const dimensions: Array<{
    event: BinanceRateReservationEvent;
    retryCost: number;
    costIds: string[];
  }> = [];
  for (const cost of quote.costs) {
    const matches = exactReservations.filter((event) => (
      event.sourceId === cost.sourceId
      && event.key.rateKind === cost.rateKind
      && event.key.scopeKind === cost.scopeKind
      && event.key.condition === cost.condition
      && event.claimInterval === cost.claimInterval
      && event.endpointCost === cost.endpointCost
      && (cost.claimInterval === 'REQUEST' || event.key.interval === cost.claimInterval)
    ));
    if (matches.length === 0) return retryNo('RATE_STATE_UNKNOWN', remaining);
    const costId = `${cost.sourceId}\u0000${cost.rateKind}\u0000${cost.scopeKind}\u0000${cost.claimInterval}\u0000${cost.condition}`;
    for (const event of matches) {
      let dimension = dimensions.find((candidate) => matchingWindow(
        event.key,
        event.windowStartedAtMs,
        event.windowEndsAtMs,
        candidate.event,
      ));
      if (dimension === undefined) {
        dimension = { event, retryCost: 0, costIds: [] };
        dimensions.push(dimension);
      }
      if (!dimension.costIds.includes(costId)) {
        dimension.costIds.push(costId);
        dimension.retryCost += cost.endpointCost;
      }
    }
  }
  if (dimensions.length === 0) return retryNo('RATE_STATE_UNKNOWN', remaining);
  let retryAtMs = futureTimes.length === 0 ? atMs : Math.max(...futureTimes);
  for (const dimension of dimensions) {
    const event = dimension.event;
    const exactHeader = state.headerEvents.some((header) => (
      header.key.contractId === contract.id
      && header.key.condition === event.key.condition
      && matchingWindow(event.key, event.windowStartedAtMs, event.windowEndsAtMs, header)
    ));
    if (!exactHeader) return retryNo('RATE_STATE_UNKNOWN', remaining);
    const capacity: BinanceRateWindowCapacity = {
      product: event.key.product,
      environment: event.key.environment,
      scopeKind: event.key.scopeKind,
      scopeHandle: event.key.scopeHandle,
      rateKind: event.key.rateKind,
      interval: event.key.interval,
      capacity: event.capacity,
      windowStartedAtMs: event.windowStartedAtMs,
      windowEndsAtMs: event.windowEndsAtMs,
    };
    const used = effectiveUsed(state, event.key, capacity);
    if (used === null) return retryNo('RATE_STATE_UNKNOWN', remaining);
    if (dimension.retryCost > event.capacity || used > event.capacity - dimension.retryCost) {
      retryAtMs = Math.max(retryAtMs, event.windowEndsAtMs);
    }
  }
  return deepFreeze({ automatic: true, reason: 'READ_ONLY_RETRY', retryAtMs, remainingAttempts: remaining });
}
