/**
 * Pure Binance Spot descriptor adapter for the validate-only Basis lifecycle.
 *
 * This boundary consumes already snapshotted public evidence, delegates exact
 * filter arithmetic to the canonical Spot filter owner, and emits inert data
 * records. It intentionally has no clock, environment, key, signing, network,
 * test-order, order, cancel, or retry capability.
 */
import { types as nodeTypes } from 'node:util';

import {
  compareSpotDecimals,
  normalizeSpotDecimal,
  validateBinanceSpotOrderFilters,
  type BinanceSpotFilterValidation,
  type BinanceSpotOrderSide,
  type BinanceSpotPriceRangeCompatibility,
} from '../binanceSpot/filters.js';
import {
  deriveBinanceSpotClientOrderId,
  isBinanceSpotClientOrderId,
} from '../binanceSpot/clientOrderId.js';
import {
  evaluateFreshness,
  isValidUtcMillis,
  validateSourcedTimestamp,
  type SourcedTimestamp,
} from '../../contracts/time.js';
import type { DataAuthority } from '../../contracts/authority.js';

export const BINANCE_SPOT_VALIDATE_ONLY_DEFAULTS = Object.freeze({
  enabled: false,
  killSwitchEngaged: true,
  authority: 'NONE' as const,
});

/**
 * Adapter-owned ceilings. Evidence may declare a shorter lifetime, never a
 * longer one. This prevents a caller from making an old public or private fact
 * appear current by supplying an arbitrarily large maxAgeMs.
 */
export const BINANCE_SPOT_VALIDATE_ONLY_FRESHNESS_POLICY = Object.freeze({
  publicFilterMaximumAgeMs: 60_000,
  publicVenueEvidenceMaximumAgeMs: 5_000,
  queryEvidenceMaximumAgeMs: 5_000,
});

export interface BinanceSpotValidateOnlyPolicy {
  readonly enabled: boolean;
  readonly killSwitchEngaged: boolean;
  readonly authority: 'NONE';
}

export interface BinanceSpotPublicSnapshot {
  readonly snapshotId: string;
  readonly symbol: string;
  readonly tradingStatus: string;
  readonly completeness: 'COMPLETE_SUPPORTED_FILTER_SET';
  readonly filterObservedAt: Readonly<SourcedTimestamp>;
  readonly venueEvidenceObservedAt: Readonly<SourcedTimestamp>;
  readonly filters: readonly unknown[];
  readonly venueEvidence: unknown;
}

export interface BinanceSpotBasisOrderInput {
  readonly planId: string;
  readonly legId: string;
  readonly attempt: number;
  readonly symbol: string;
  /** Supplied by the plan and checked against the canonical deterministic ID. */
  readonly clientOrderId: string;
  readonly side: BinanceSpotOrderSide;
  readonly type: 'LIMIT' | 'MARKET';
  readonly quantity: string;
  readonly price: string | null;
  readonly timeInForce: 'GTC' | null;
}

export const BINANCE_SPOT_PREPARATION_BLOCKING_CODES = [
  'INPUT_NOT_PLAIN_DATA',
  'POLICY_INVALID',
  'VALIDATE_ONLY_DISABLED',
  'KILL_SWITCH_ENGAGED',
  'SNAPSHOT_INVALID',
  'SNAPSHOT_INCOMPLETE',
  'FILTER_EVIDENCE_STALE',
  'FILTER_EVIDENCE_CLOCK_SKEWED',
  'FILTER_EVIDENCE_MAX_AGE_EXCEEDED',
  'VENUE_EVIDENCE_STALE',
  'VENUE_EVIDENCE_CLOCK_SKEWED',
  'VENUE_EVIDENCE_MAX_AGE_EXCEEDED',
  'SYMBOL_NOT_TRADING',
  'SYMBOL_MISMATCH',
  'ORDER_INVALID',
  'CLIENT_ORDER_ID_MISMATCH',
  'PUBLIC_FILTER_VALIDATION_FAILED',
] as const;

export type BinanceSpotPreparationBlockingCode =
  (typeof BINANCE_SPOT_PREPARATION_BLOCKING_CODES)[number];

export interface BinanceSpotOrderWireIntent {
  readonly kind: 'BINANCE_SPOT_ORDER_WIRE_INTENT';
  readonly descriptorVersion: 1;
  readonly venue: 'BINANCE_SPOT';
  readonly symbol: string;
  readonly clientOrderId: string;
  readonly planId: string;
  readonly legId: string;
  readonly attempt: number;
  readonly side: BinanceSpotOrderSide;
  readonly type: 'LIMIT' | 'MARKET';
  readonly quantity: string;
  readonly price: string | null;
  readonly timeInForce: 'GTC' | null;
  readonly security: 'SIGNED';
  readonly sendCapability: 'ABSENT';
  readonly sendEligible: false;
}

export interface BinanceSpotSignedQueryDescriptor {
  readonly kind: 'BINANCE_SPOT_SIGNED_QUERY_DESCRIPTOR';
  readonly descriptorVersion: 1;
  readonly venue: 'BINANCE_SPOT';
  readonly method: 'GET';
  readonly path: '/api/v3/order';
  readonly security: 'SIGNED';
  readonly parameters: Readonly<{
    readonly symbol: string;
    readonly origClientOrderId: string;
  }>;
  readonly transportCapability: 'ABSENT';
}

export interface BinanceSpotValidateOnlyPreparation {
  readonly kind: 'BINANCE_SPOT_VALIDATE_ONLY_PREPARATION';
  readonly status: 'VALIDATED' | 'BLOCKED';
  readonly policy: Readonly<BinanceSpotValidateOnlyPolicy>;
  readonly authority: 'NONE';
  readonly sendEligible: false;
  readonly transportCapability: 'ABSENT';
  readonly snapshotId: string | null;
  readonly blockingCodes:
    readonly BinanceSpotPreparationBlockingCode[];
  readonly filterValidation:
    | Readonly<BinanceSpotFilterValidation>
    | null;
  readonly priceRangeRisk:
    | Readonly<BinanceSpotPriceRangeCompatibility>
    | null;
  readonly wireIntent: Readonly<BinanceSpotOrderWireIntent> | null;
  readonly queryDescriptor:
    | Readonly<BinanceSpotSignedQueryDescriptor>
    | null;
}

const preparations = new WeakSet<object>();
const queryResolutions = new WeakSet<object>();

/**
 * Nominal, side-effect-free provenance guard. WeakSet.has does not inspect or
 * dereference the supplied value, including when that value is a Proxy.
 */
export function isBinanceSpotValidateOnlyPreparation(
  value: unknown,
): value is Readonly<BinanceSpotValidateOnlyPreparation> {
  return (
    (typeof value === 'object' && value !== null) ||
    typeof value === 'function'
  )
    ? preparations.has(value as object)
    : false;
}

class PlainDataError extends TypeError {}

interface PlainDataBudget {
  nodes: number;
}

function clonePlainData(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  budget: PlainDataBudget,
  depth = 0,
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new PlainDataError(`${path} number must be a safe integer`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new PlainDataError(`${path} must contain plain JSON-like data`);
  }
  if (nodeTypes.isProxy(value)) {
    throw new PlainDataError(`${path} must not be a Proxy`);
  }
  if (depth > 16 || (budget.nodes += 1) > 1_024) {
    throw new PlainDataError(`${path} exceeds the plain-data bound`);
  }
  if (seen.has(value)) {
    throw new PlainDataError(`${path} must be acyclic`);
  }
  seen.add(value);

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value) as object | null;
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new PlainDataError(`${path} cannot be inspected as plain data`);
  }

  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) {
      throw new PlainDataError(`${path} must be a plain array`);
    }
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.some((key) => typeof key !== 'string') ||
      !Object.hasOwn(descriptors, 'length')
    ) {
      throw new PlainDataError(`${path} has unsupported array keys`);
    }
    const lengthDescriptor = descriptors.length;
    const length = lengthDescriptor?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 256) {
      throw new PlainDataError(`${path} array length is invalid`);
    }
    const allowed = new Set([
      'length',
      ...Array.from({ length }, (_, index) => String(index)),
    ]);
    if (
      keys.some((key) => !allowed.has(key as string)) ||
      Array.from({ length }, (_, index) => String(index)).some(
        (key) => !Object.hasOwn(descriptors, key),
      )
    ) {
      throw new PlainDataError(`${path} must be a dense plain array`);
    }
    const copy = Array.from({ length }, (_, index) => {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw new PlainDataError(`${path}[${String(index)}] is an accessor`);
      }
      return clonePlainData(
        descriptor.value,
        `${path}[${String(index)}]`,
        seen,
        budget,
        depth + 1,
      );
    });
    seen.delete(value);
    return Object.freeze(copy);
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new PlainDataError(`${path} must be a plain object`);
  }
  const copy: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') {
      throw new PlainDataError(`${path} must not contain symbol keys`);
    }
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.hasOwn(descriptor, 'value') ||
      !descriptor.enumerable
    ) {
      throw new PlainDataError(`${path}.${key} must be enumerable data`);
    }
    copy[key] = clonePlainData(
      descriptor.value,
      `${path}.${key}`,
      seen,
      budget,
      depth + 1,
    );
  }
  seen.delete(value);
  return Object.freeze(copy);
}

function readPlainRecord(value: unknown): Record<string, unknown> {
  const cloned = clonePlainData(
    value,
    'input',
    new WeakSet<object>(),
    { nodes: 0 },
  );
  if (cloned === null || typeof cloned !== 'object' || Array.isArray(cloned)) {
    throw new PlainDataError('input must be a plain object');
  }
  return cloned as Record<string, unknown>;
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function nonEmptyToken(
  value: unknown,
  maxLength = 160,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
  );
}

function validSymbol(value: unknown): value is string {
  return (
    nonEmptyToken(value, 40) &&
    /^[A-Z0-9]{2,40}$/.test(value)
  );
}

function parsePolicy(
  value: unknown,
): Readonly<BinanceSpotValidateOnlyPolicy> | null {
  if (value === undefined) return BINANCE_SPOT_VALIDATE_ONLY_DEFAULTS;
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !hasExactKeys(record, ['enabled', 'killSwitchEngaged', 'authority']) ||
    typeof record.enabled !== 'boolean' ||
    typeof record.killSwitchEngaged !== 'boolean' ||
    record.authority !== 'NONE'
  ) {
    return null;
  }
  return Object.freeze({
    enabled: record.enabled,
    killSwitchEngaged: record.killSwitchEngaged,
    authority: 'NONE' as const,
  });
}

type FreshnessFailure =
  | 'INVALID'
  | 'STALE'
  | 'CLOCK_SKEWED'
  | 'MAX_AGE_EXCEEDS_POLICY';

function validateFreshProvenance(
  value: unknown,
  evaluatedAtMs: number,
  allowedAuthorities: readonly DataAuthority[],
  maximumAgeMs: number,
): FreshnessFailure | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    validateSourcedTimestamp(value).length > 0
  ) {
    return 'INVALID';
  }
  const timestamp = value as unknown as SourcedTimestamp;
  if (
    timestamp.completeness !== 'COMPLETE' ||
    !allowedAuthorities.includes(timestamp.authority) ||
    (timestamp.sourceTimeMs !== null &&
      timestamp.sourceTimeMs > timestamp.receivedAtMs)
  ) {
    return 'INVALID';
  }
  if (timestamp.maxAgeMs > maximumAgeMs) {
    return 'MAX_AGE_EXCEEDS_POLICY';
  }
  if (
    timestamp.receivedAtMs > evaluatedAtMs ||
    (timestamp.sourceTimeMs !== null &&
      timestamp.sourceTimeMs > evaluatedAtMs)
  ) {
    return 'CLOCK_SKEWED';
  }
  const report = evaluateFreshness(timestamp, evaluatedAtMs);
  if (report.state === 'STALE') return 'STALE';
  if (report.state === 'CLOCK_SKEWED') return 'CLOCK_SKEWED';
  return report.state === 'FRESH' ? null : 'INVALID';
}

function freezePreparation(
  value: BinanceSpotValidateOnlyPreparation,
): Readonly<BinanceSpotValidateOnlyPreparation> {
  const frozen = Object.freeze({
    ...value,
    policy: Object.freeze({ ...value.policy }),
    blockingCodes: Object.freeze([...value.blockingCodes]),
  });
  preparations.add(frozen);
  return frozen;
}

function invalidPreparation(
  code: BinanceSpotPreparationBlockingCode,
): Readonly<BinanceSpotValidateOnlyPreparation> {
  return freezePreparation({
    kind: 'BINANCE_SPOT_VALIDATE_ONLY_PREPARATION',
    status: 'BLOCKED',
    policy: BINANCE_SPOT_VALIDATE_ONLY_DEFAULTS,
    authority: 'NONE',
    sendEligible: false,
    transportCapability: 'ABSENT',
    snapshotId: null,
    blockingCodes: Object.freeze([code]),
    filterValidation: null,
    priceRangeRisk: null,
    wireIntent: null,
    queryDescriptor: null,
  });
}

/**
 * Validate a Basis Spot leg and construct immutable inert descriptors.
 *
 * Policy gates deliberately do not suppress descriptor construction: an
 * immutable candidate can be inspected while default-OFF / kill-ON remains
 * visibly blocked. No returned field is callable.
 */
export function prepareBinanceSpotValidateOnlyOrder(
  input: unknown,
): Readonly<BinanceSpotValidateOnlyPreparation> {
  let root: Record<string, unknown>;
  try {
    root = readPlainRecord(input);
  } catch {
    return invalidPreparation('INPUT_NOT_PLAIN_DATA');
  }
  if (
    !hasExactKeys(
      root,
      ['evaluatedAtMs', 'publicSnapshot', 'order'],
      ['policy'],
    ) ||
    !isValidUtcMillis(root.evaluatedAtMs) ||
    root.publicSnapshot === null ||
    typeof root.publicSnapshot !== 'object' ||
    Array.isArray(root.publicSnapshot) ||
    root.order === null ||
    typeof root.order !== 'object' ||
    Array.isArray(root.order)
  ) {
    return invalidPreparation('INPUT_NOT_PLAIN_DATA');
  }

  const blockingCodes: BinanceSpotPreparationBlockingCode[] = [];
  const policy = parsePolicy(root.policy);
  if (policy === null) blockingCodes.push('POLICY_INVALID');
  const effectivePolicy = policy ?? BINANCE_SPOT_VALIDATE_ONLY_DEFAULTS;
  if (!effectivePolicy.enabled) blockingCodes.push('VALIDATE_ONLY_DISABLED');
  if (effectivePolicy.killSwitchEngaged) {
    blockingCodes.push('KILL_SWITCH_ENGAGED');
  }

  const snapshot = root.publicSnapshot as Record<string, unknown>;
  const snapshotShape = hasExactKeys(snapshot, [
    'snapshotId',
    'symbol',
    'tradingStatus',
    'completeness',
    'filterObservedAt',
    'venueEvidenceObservedAt',
    'filters',
    'venueEvidence',
  ]);
  if (
    !snapshotShape ||
    !nonEmptyToken(snapshot.snapshotId) ||
    !validSymbol(snapshot.symbol) ||
    !Array.isArray(snapshot.filters) ||
    snapshot.venueEvidence === null ||
    typeof snapshot.venueEvidence !== 'object' ||
    Array.isArray(snapshot.venueEvidence)
  ) {
    blockingCodes.push('SNAPSHOT_INVALID');
  }
  if (isValidUtcMillis(root.evaluatedAtMs)) {
    const filterFreshness = validateFreshProvenance(
      snapshot.filterObservedAt,
      root.evaluatedAtMs,
      ['LIVE_PUBLIC', 'RECORDED_REPLAY', 'SYNTHETIC_TEST'],
      BINANCE_SPOT_VALIDATE_ONLY_FRESHNESS_POLICY
        .publicFilterMaximumAgeMs,
    );
    if (filterFreshness === 'INVALID') {
      blockingCodes.push('SNAPSHOT_INVALID');
    } else if (filterFreshness === 'STALE') {
      blockingCodes.push('FILTER_EVIDENCE_STALE');
    } else if (filterFreshness === 'CLOCK_SKEWED') {
      blockingCodes.push('FILTER_EVIDENCE_CLOCK_SKEWED');
    } else if (filterFreshness === 'MAX_AGE_EXCEEDS_POLICY') {
      blockingCodes.push('FILTER_EVIDENCE_MAX_AGE_EXCEEDED');
    }
    const venueFreshness = validateFreshProvenance(
      snapshot.venueEvidenceObservedAt,
      root.evaluatedAtMs,
      ['LIVE_PUBLIC', 'RECORDED_REPLAY', 'SYNTHETIC_TEST'],
      BINANCE_SPOT_VALIDATE_ONLY_FRESHNESS_POLICY
        .publicVenueEvidenceMaximumAgeMs,
    );
    if (venueFreshness === 'INVALID') {
      blockingCodes.push('SNAPSHOT_INVALID');
    } else if (venueFreshness === 'STALE') {
      blockingCodes.push('VENUE_EVIDENCE_STALE');
    } else if (venueFreshness === 'CLOCK_SKEWED') {
      blockingCodes.push('VENUE_EVIDENCE_CLOCK_SKEWED');
    } else if (venueFreshness === 'MAX_AGE_EXCEEDS_POLICY') {
      blockingCodes.push('VENUE_EVIDENCE_MAX_AGE_EXCEEDED');
    }
  }
  if (snapshot.completeness !== 'COMPLETE_SUPPORTED_FILTER_SET') {
    blockingCodes.push('SNAPSHOT_INCOMPLETE');
  }
  if (snapshot.tradingStatus !== 'TRADING') {
    blockingCodes.push('SYMBOL_NOT_TRADING');
  }

  const order = root.order as Record<string, unknown>;
  const orderShape = hasExactKeys(order, [
    'planId',
    'legId',
    'attempt',
    'symbol',
    'clientOrderId',
    'side',
    'type',
    'quantity',
    'price',
    'timeInForce',
  ]);

  let normalizedQuantity: string | null = null;
  let normalizedPrice: string | null = null;
  let normalizedOrder = false;
  if (
    orderShape &&
    nonEmptyToken(order.planId) &&
    nonEmptyToken(order.legId) &&
    Number.isSafeInteger(order.attempt) &&
    (order.attempt as number) >= 0 &&
    validSymbol(order.symbol) &&
    isBinanceSpotClientOrderId(order.clientOrderId) &&
    (order.side === 'BUY' || order.side === 'SELL') &&
    (order.type === 'LIMIT' || order.type === 'MARKET') &&
    typeof order.quantity === 'string'
  ) {
    try {
      normalizedQuantity = normalizeSpotDecimal(
        order.quantity,
        'order.quantity',
      );
      if (compareSpotDecimals(normalizedQuantity, '0') <= 0) {
        throw new TypeError('quantity must be positive');
      }
      if (
        order.type === 'LIMIT' &&
        typeof order.price === 'string' &&
        order.timeInForce === 'GTC'
      ) {
        normalizedPrice = normalizeSpotDecimal(order.price, 'order.price');
        if (compareSpotDecimals(normalizedPrice, '0') <= 0) {
          throw new TypeError('price must be positive');
        }
        normalizedOrder = true;
      } else if (
        order.type === 'MARKET' &&
        order.price === null &&
        order.timeInForce === null
      ) {
        normalizedOrder = true;
      }
    } catch {
      normalizedOrder = false;
    }
  }
  if (!normalizedOrder) blockingCodes.push('ORDER_INVALID');

  if (
    validSymbol(snapshot.symbol) &&
    validSymbol(order.symbol) &&
    snapshot.symbol !== order.symbol
  ) {
    blockingCodes.push('SYMBOL_MISMATCH');
  }

  if (
    nonEmptyToken(order.planId) &&
    nonEmptyToken(order.legId) &&
    Number.isSafeInteger(order.attempt) &&
    (order.attempt as number) >= 0 &&
    isBinanceSpotClientOrderId(order.clientOrderId)
  ) {
    let expectedClientOrderId: string | null = null;
    try {
      expectedClientOrderId = deriveBinanceSpotClientOrderId({
        planId: order.planId,
        legId: order.legId,
        attempt: order.attempt as number,
      });
    } catch {
      expectedClientOrderId = null;
    }
    if (expectedClientOrderId !== order.clientOrderId) {
      blockingCodes.push('CLIENT_ORDER_ID_MISMATCH');
    }
  } else if (!blockingCodes.includes('ORDER_INVALID')) {
    blockingCodes.push('ORDER_INVALID');
  }

  let filterValidation: Readonly<BinanceSpotFilterValidation> | null = null;
  if (
    normalizedOrder &&
    normalizedQuantity !== null &&
    Array.isArray(snapshot.filters) &&
    snapshot.venueEvidence !== null &&
    typeof snapshot.venueEvidence === 'object' &&
    !Array.isArray(snapshot.venueEvidence) &&
    (order.side === 'BUY' || order.side === 'SELL') &&
    (order.type === 'LIMIT' || order.type === 'MARKET')
  ) {
    filterValidation = validateBinanceSpotOrderFilters(
      Object.freeze({
        side: order.side,
        type: order.type,
        quantity: normalizedQuantity,
        price: normalizedPrice,
      }),
      snapshot.filters,
      snapshot.venueEvidence as never,
    );
    if (!filterValidation.ok) {
      blockingCodes.push('PUBLIC_FILTER_VALIDATION_FAILED');
    }
  }

  const structuralBlocks = blockingCodes.some((code) =>
    [
      'INPUT_NOT_PLAIN_DATA',
      'POLICY_INVALID',
      'SNAPSHOT_INVALID',
      'SNAPSHOT_INCOMPLETE',
      'FILTER_EVIDENCE_STALE',
      'FILTER_EVIDENCE_CLOCK_SKEWED',
      'FILTER_EVIDENCE_MAX_AGE_EXCEEDED',
      'VENUE_EVIDENCE_STALE',
      'VENUE_EVIDENCE_CLOCK_SKEWED',
      'VENUE_EVIDENCE_MAX_AGE_EXCEEDED',
      'SYMBOL_NOT_TRADING',
      'SYMBOL_MISMATCH',
      'ORDER_INVALID',
      'CLIENT_ORDER_ID_MISMATCH',
      'PUBLIC_FILTER_VALIDATION_FAILED',
    ].includes(code),
  );

  let wireIntent: Readonly<BinanceSpotOrderWireIntent> | null = null;
  let queryDescriptor: Readonly<BinanceSpotSignedQueryDescriptor> | null = null;
  if (
    !structuralBlocks &&
    normalizedQuantity !== null &&
    validSymbol(order.symbol) &&
    isBinanceSpotClientOrderId(order.clientOrderId) &&
    nonEmptyToken(order.planId) &&
    nonEmptyToken(order.legId) &&
    Number.isSafeInteger(order.attempt) &&
    (order.side === 'BUY' || order.side === 'SELL') &&
    (order.type === 'LIMIT' || order.type === 'MARKET')
  ) {
    wireIntent = Object.freeze({
      kind: 'BINANCE_SPOT_ORDER_WIRE_INTENT',
      descriptorVersion: 1,
      venue: 'BINANCE_SPOT',
      symbol: order.symbol,
      clientOrderId: order.clientOrderId,
      planId: order.planId,
      legId: order.legId,
      attempt: order.attempt as number,
      side: order.side,
      type: order.type,
      quantity: normalizedQuantity,
      price: normalizedPrice,
      timeInForce: order.type === 'LIMIT' ? 'GTC' : null,
      security: 'SIGNED',
      sendCapability: 'ABSENT',
      sendEligible: false,
    });
    queryDescriptor = Object.freeze({
      kind: 'BINANCE_SPOT_SIGNED_QUERY_DESCRIPTOR',
      descriptorVersion: 1,
      venue: 'BINANCE_SPOT',
      method: 'GET',
      path: '/api/v3/order',
      security: 'SIGNED',
      parameters: Object.freeze({
        symbol: order.symbol,
        origClientOrderId: order.clientOrderId,
      }),
      transportCapability: 'ABSENT',
    });
  }

  const uniqueCodes = Object.freeze([...new Set(blockingCodes)]);
  return freezePreparation({
    kind: 'BINANCE_SPOT_VALIDATE_ONLY_PREPARATION',
    status: uniqueCodes.length === 0 ? 'VALIDATED' : 'BLOCKED',
    policy: effectivePolicy,
    authority: 'NONE',
    sendEligible: false,
    transportCapability: 'ABSENT',
    snapshotId: nonEmptyToken(snapshot.snapshotId) ? snapshot.snapshotId : null,
    blockingCodes: uniqueCodes,
    filterValidation,
    priceRangeRisk: filterValidation?.priceRange ?? null,
    wireIntent,
    queryDescriptor,
  });
}

export type BinanceSpotMutationKnowledge =
  | 'KNOWN_NOT_SUBMITTED'
  | 'KNOWN_SUBMITTED'
  | 'UNCERTAIN';

export type BinanceSpotObservedOrderStatus =
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  /**
   * Binance's wire spelling is intentionally preserved here. The lifecycle's
   * reconciliation projection is the sole mapping point to internal
   * `CANCELLED`; adapters must not silently rewrite venue evidence.
   */
  | 'CANCELED'
  | 'PENDING_CANCEL'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXPIRED_IN_MATCH';

export interface BinanceSpotFoundQueryEvidence {
  readonly outcome: 'FOUND';
  readonly observedAt: Readonly<SourcedTimestamp>;
  readonly symbol: string;
  readonly clientOrderId: string;
  readonly venueOrderId: string;
  readonly side: BinanceSpotOrderSide;
  readonly type: 'LIMIT' | 'MARKET';
  /**
   * Binance reports GTC for both LIMIT GTC and MARKET query records. MARKET
   * submission intent remains null because no TIF is sent for MARKET.
   */
  readonly timeInForce: 'GTC';
  readonly quantity: string;
  readonly price: string | null;
  readonly executedQuantity: string;
  readonly status: BinanceSpotObservedOrderStatus;
}

export interface BinanceSpotMissingQueryEvidence {
  readonly outcome: 'NOT_FOUND' | 'AMBIGUOUS';
  readonly observedAt: Readonly<SourcedTimestamp>;
  readonly symbol: string;
  readonly clientOrderId: string;
}

export type BinanceSpotInjectedQueryEvidence =
  | BinanceSpotFoundQueryEvidence
  | BinanceSpotMissingQueryEvidence;

export const BINANCE_SPOT_QUERY_REASON_CODES = [
  'PREPARATION_INVALID',
  'QUERY_INPUT_NOT_PLAIN_DATA',
  'QUERY_IDENTITY_MISMATCH',
  'QUERY_EVIDENCE_INVALID',
  'QUERY_EVIDENCE_STALE',
  'QUERY_EVIDENCE_CLOCK_SKEWED',
  'QUERY_EVIDENCE_MAX_AGE_EXCEEDED',
  'QUERY_STATUS_FILL_INCOHERENT',
  'QUERY_AMBIGUOUS',
  'QUERY_NOT_FOUND_AFTER_MUTATION',
  'QUERY_NOT_FOUND_AFTER_UNCERTAIN_MUTATION',
] as const;

export type BinanceSpotQueryReasonCode =
  (typeof BINANCE_SPOT_QUERY_REASON_CODES)[number];

export interface BinanceSpotNormalizedOrderObservation {
  readonly venue: 'BINANCE_SPOT';
  readonly observedAt: Readonly<SourcedTimestamp>;
  readonly symbol: string;
  readonly clientOrderId: string;
  readonly venueOrderId: string;
  readonly side: BinanceSpotOrderSide;
  readonly type: 'LIMIT' | 'MARKET';
  readonly timeInForce: 'GTC';
  readonly quantity: string;
  readonly price: string | null;
  readonly executedQuantity: string;
  readonly status: BinanceSpotObservedOrderStatus;
}

export interface BinanceSpotQueryResolution {
  readonly kind: 'BINANCE_SPOT_QUERY_RESOLUTION';
  readonly state: 'OBSERVED' | 'ABSENT' | 'UNKNOWN';
  readonly recoveryAction: 'NONE' | 'QUERY_REQUIRED';
  readonly authority: 'NONE';
  readonly clientOrderId: string | null;
  readonly resubmitAllowed: false;
  readonly replacementClientOrderId: null;
  readonly reasonCodes: readonly BinanceSpotQueryReasonCode[];
  readonly observation:
    | Readonly<BinanceSpotNormalizedOrderObservation>
    | null;
}

export function isBinanceSpotQueryResolution(
  value: unknown,
): value is Readonly<BinanceSpotQueryResolution> {
  return (
    (typeof value === 'object' && value !== null) ||
    typeof value === 'function'
  )
    ? queryResolutions.has(value as object)
    : false;
}

function freezeQueryResolution(
  value: BinanceSpotQueryResolution,
): Readonly<BinanceSpotQueryResolution> {
  const frozen = Object.freeze({
    ...value,
    reasonCodes: Object.freeze([...value.reasonCodes]),
  });
  queryResolutions.add(frozen);
  return frozen;
}

function unknownQueryResolution(
  clientOrderId: string | null,
  reason: BinanceSpotQueryReasonCode,
): Readonly<BinanceSpotQueryResolution> {
  return freezeQueryResolution({
    kind: 'BINANCE_SPOT_QUERY_RESOLUTION',
    state: 'UNKNOWN',
    recoveryAction: 'QUERY_REQUIRED',
    authority: 'NONE',
    clientOrderId,
    resubmitAllowed: false,
    replacementClientOrderId: null,
    reasonCodes: Object.freeze([reason]),
    observation: null,
  });
}

interface FoundEvidenceNormalization {
  readonly observation:
    | Readonly<BinanceSpotNormalizedOrderObservation>
    | null;
  readonly failure:
    | 'QUERY_EVIDENCE_INVALID'
    | 'QUERY_IDENTITY_MISMATCH'
    | 'QUERY_STATUS_FILL_INCOHERENT'
    | null;
}

function normalizeFoundEvidence(
  intent: Readonly<BinanceSpotOrderWireIntent>,
  evidence: Record<string, unknown>,
): Readonly<FoundEvidenceNormalization> {
  const expectedQueryTimeInForce =
    intent.type === 'MARKET' ? 'GTC' : intent.timeInForce;
  if (
    !hasExactKeys(evidence, [
      'outcome',
      'observedAt',
      'symbol',
      'clientOrderId',
      'venueOrderId',
      'side',
      'type',
      'timeInForce',
      'quantity',
      'price',
      'executedQuantity',
      'status',
    ]) ||
    evidence.outcome !== 'FOUND' ||
    !/^(?:0|[1-9][0-9]*)$/.test(
      typeof evidence.venueOrderId === 'string'
        ? evidence.venueOrderId
        : '',
    ) ||
    !(
      [
        'NEW',
        'PARTIALLY_FILLED',
        'FILLED',
        'CANCELED',
        'PENDING_CANCEL',
        'REJECTED',
        'EXPIRED',
        'EXPIRED_IN_MATCH',
      ] as readonly unknown[]
    ).includes(evidence.status) ||
    typeof evidence.quantity !== 'string' ||
    typeof evidence.executedQuantity !== 'string'
  ) {
    return Object.freeze({
      observation: null,
      failure: 'QUERY_EVIDENCE_INVALID',
    });
  }
  let quantity: string;
  let executedQuantity: string;
  let price: string | null;
  try {
    quantity = normalizeSpotDecimal(evidence.quantity, 'evidence.quantity');
    executedQuantity = normalizeSpotDecimal(
      evidence.executedQuantity,
      'evidence.executedQuantity',
    );
    price =
      evidence.price === null
        ? null
        : normalizeSpotDecimal(
            evidence.price as string,
            'evidence.price',
          );
  } catch {
    return Object.freeze({
      observation: null,
      failure: 'QUERY_EVIDENCE_INVALID',
    });
  }
  if (
    evidence.symbol !== intent.symbol ||
    evidence.clientOrderId !== intent.clientOrderId ||
    evidence.side !== intent.side ||
    evidence.type !== intent.type ||
    expectedQueryTimeInForce !== 'GTC' ||
    evidence.timeInForce !== expectedQueryTimeInForce ||
    quantity !== intent.quantity ||
    price !== intent.price
  ) {
    return Object.freeze({
      observation: null,
      failure: 'QUERY_IDENTITY_MISMATCH',
    });
  }
  const fillComparedToZero = compareSpotDecimals(executedQuantity, '0');
  const fillComparedToQuantity = compareSpotDecimals(
    executedQuantity,
    quantity,
  );
  const status = evidence.status as BinanceSpotObservedOrderStatus;
  const coherent =
    (status === 'FILLED' && fillComparedToQuantity === 0) ||
    ((status === 'NEW' || status === 'REJECTED') &&
      fillComparedToZero === 0) ||
    (status === 'PARTIALLY_FILLED' &&
      fillComparedToZero > 0 &&
      fillComparedToQuantity < 0) ||
    ((status === 'PENDING_CANCEL' ||
      status === 'CANCELED' ||
      status === 'EXPIRED' ||
      status === 'EXPIRED_IN_MATCH') &&
      fillComparedToZero >= 0 &&
      fillComparedToQuantity < 0);
  if (!coherent) {
    return Object.freeze({
      observation: null,
      failure: 'QUERY_STATUS_FILL_INCOHERENT',
    });
  }
  const observation = Object.freeze({
    venue: 'BINANCE_SPOT',
    observedAt: Object.freeze({
      ...(evidence.observedAt as unknown as SourcedTimestamp),
    }),
    symbol: intent.symbol,
    clientOrderId: intent.clientOrderId,
    venueOrderId: evidence.venueOrderId as string,
    side: intent.side,
    type: intent.type,
    timeInForce: expectedQueryTimeInForce,
    quantity,
    price,
    executedQuantity,
    status,
  });
  return Object.freeze({ observation, failure: null });
}

/**
 * Normalize an injected query observation against every exchange-visible
 * identity field of the prepared intent. This function never recommends a
 * submission: ambiguity and post-mutation absence retain the same client ID
 * and remain query-required UNKNOWN.
 */
export function normalizeBinanceSpotInjectedQueryEvidence(
  preparation: unknown,
  input: unknown,
): Readonly<BinanceSpotQueryResolution> {
  if (
    !isBinanceSpotValidateOnlyPreparation(preparation) ||
    preparation.wireIntent === null ||
    preparation.queryDescriptor === null
  ) {
    return unknownQueryResolution(null, 'PREPARATION_INVALID');
  }
  const intent = preparation.wireIntent;
  let root: Record<string, unknown>;
  try {
    root = readPlainRecord(input);
  } catch {
    return unknownQueryResolution(
      intent.clientOrderId,
      'QUERY_INPUT_NOT_PLAIN_DATA',
    );
  }
  if (
    !hasExactKeys(
      root,
      ['evaluatedAtMs', 'mutationKnowledge', 'evidence'],
    ) ||
    !isValidUtcMillis(root.evaluatedAtMs) ||
    !(
      [
        'KNOWN_NOT_SUBMITTED',
        'KNOWN_SUBMITTED',
        'UNCERTAIN',
      ] as readonly unknown[]
    ).includes(root.mutationKnowledge) ||
    root.evidence === null ||
    typeof root.evidence !== 'object' ||
    Array.isArray(root.evidence)
  ) {
    return unknownQueryResolution(
      intent.clientOrderId,
      'QUERY_EVIDENCE_INVALID',
    );
  }
  const evidence = root.evidence as Record<string, unknown>;
  const queryFreshness = validateFreshProvenance(
    evidence.observedAt,
    root.evaluatedAtMs as number,
    ['LIVE_PRIVATE', 'RECORDED_REPLAY', 'SYNTHETIC_TEST'],
    BINANCE_SPOT_VALIDATE_ONLY_FRESHNESS_POLICY.queryEvidenceMaximumAgeMs,
  );
  if (queryFreshness === 'INVALID') {
    return unknownQueryResolution(
      intent.clientOrderId,
      'QUERY_EVIDENCE_INVALID',
    );
  }
  if (queryFreshness === 'STALE') {
    return unknownQueryResolution(
      intent.clientOrderId,
      'QUERY_EVIDENCE_STALE',
    );
  }
  if (queryFreshness === 'CLOCK_SKEWED') {
    return unknownQueryResolution(
      intent.clientOrderId,
      'QUERY_EVIDENCE_CLOCK_SKEWED',
    );
  }
  if (queryFreshness === 'MAX_AGE_EXCEEDS_POLICY') {
    return unknownQueryResolution(
      intent.clientOrderId,
      'QUERY_EVIDENCE_MAX_AGE_EXCEEDED',
    );
  }
  if (
    evidence.symbol !== intent.symbol ||
    evidence.clientOrderId !== intent.clientOrderId
  ) {
    return unknownQueryResolution(
      intent.clientOrderId,
      'QUERY_IDENTITY_MISMATCH',
    );
  }

  if (evidence.outcome === 'AMBIGUOUS') {
    if (
      !hasExactKeys(evidence, [
        'outcome',
        'observedAt',
        'symbol',
        'clientOrderId',
      ])
    ) {
      return unknownQueryResolution(
        intent.clientOrderId,
        'QUERY_EVIDENCE_INVALID',
      );
    }
    return unknownQueryResolution(intent.clientOrderId, 'QUERY_AMBIGUOUS');
  }
  if (evidence.outcome === 'NOT_FOUND') {
    if (
      !hasExactKeys(evidence, [
        'outcome',
        'observedAt',
        'symbol',
        'clientOrderId',
      ])
    ) {
      return unknownQueryResolution(
        intent.clientOrderId,
        'QUERY_EVIDENCE_INVALID',
      );
    }
    if (root.mutationKnowledge === 'KNOWN_NOT_SUBMITTED') {
      return freezeQueryResolution({
        kind: 'BINANCE_SPOT_QUERY_RESOLUTION',
        state: 'ABSENT',
        recoveryAction: 'NONE',
        authority: 'NONE',
        clientOrderId: intent.clientOrderId,
        resubmitAllowed: false,
        replacementClientOrderId: null,
        reasonCodes: Object.freeze([]),
        observation: null,
      });
    }
    return unknownQueryResolution(
      intent.clientOrderId,
      root.mutationKnowledge === 'UNCERTAIN'
        ? 'QUERY_NOT_FOUND_AFTER_UNCERTAIN_MUTATION'
        : 'QUERY_NOT_FOUND_AFTER_MUTATION',
    );
  }
  if (evidence.outcome !== 'FOUND') {
    return unknownQueryResolution(
      intent.clientOrderId,
      'QUERY_EVIDENCE_INVALID',
    );
  }
  const normalized = normalizeFoundEvidence(intent, evidence);
  if (normalized.observation === null) {
    return unknownQueryResolution(
      intent.clientOrderId,
      normalized.failure ?? 'QUERY_EVIDENCE_INVALID',
    );
  }
  return freezeQueryResolution({
    kind: 'BINANCE_SPOT_QUERY_RESOLUTION',
    state: 'OBSERVED',
    recoveryAction: 'NONE',
    authority: 'NONE',
    clientOrderId: intent.clientOrderId,
    resubmitAllowed: false,
    replacementClientOrderId: null,
    reasonCodes: Object.freeze([]),
    observation: normalized.observation,
  });
}
