/**
 * Exact Binance Spot symbol-filter validation for base-quantity orders.
 *
 * Supported current Spot filters:
 * PRICE_FILTER, PERCENT_PRICE_BY_SIDE, LOT_SIZE, MARKET_LOT_SIZE,
 * MIN_NOTIONAL, and NOTIONAL.
 * Callers supply the execution projection of the authority-owned normalized
 * instrument snapshot; this module does not fetch, normalize, version, or
 * persist an exchangeInfo registry.
 *
 * Two constraint families are reference-price bound and therefore cannot be
 * answered from exchangeInfo alone:
 * - PERCENT_PRICE_BY_SIDE publishes side multipliers in exchangeInfo but is
 *   evaluated against a venue reference price that moves independently of the
 *   snapshot. That reference must be supplied as venue evidence; a ticket's
 *   own risk price is never an acceptable substitute for it.
 * - PRICE_RANGE is not an exchangeInfo filter at all. Its rules are published
 *   separately and its reference price changes at execution time, so it is
 *   modeled as separate injected evidence rather than a snapshot entry.
 * MARKET notional checks use the same venue-owned reference-first price
 * selection. This module never fetches, substitutes, or guesses that price.
 *
 * Local filter validation is not venue acceptance. PRICE_RANGE compatibility
 * is descriptive only because its limits are fixed later, at taker execution.
 *
 * Pure module: no I/O, clocks, environment reads, or floating-point math.
 */

const PLAIN_DECIMAL = /^(?:0|[0-9]+)(?:\.[0-9]+)?$/;
const MAX_DECIMAL_CHARACTERS = 120;
// Arithmetic remains bounded while accepting the exact output of one
// multiplication between two valid public inputs.
const MAX_COMPUTED_DECIMAL_CHARACTERS = MAX_DECIMAL_CHARACTERS * 2;

interface ExactDecimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

function parseDecimal(
  value: unknown,
  fieldName: string,
  maxCharacters = MAX_DECIMAL_CHARACTERS,
): ExactDecimal {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxCharacters ||
    !PLAIN_DECIMAL.test(value)
  ) {
    throw new TypeError(`${fieldName} must be a non-negative plain decimal string`);
  }
  const [whole, fraction = ''] = value.split('.');
  let coefficient = BigInt(`${whole}${fraction}`);
  let scale = fraction.length;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return Object.freeze({ coefficient, scale });
}

function rescale(value: ExactDecimal, scale: number): bigint {
  return value.coefficient * 10n ** BigInt(scale - value.scale);
}

function formatDecimal(value: ExactDecimal): string {
  let digits = value.coefficient.toString();
  if (value.scale === 0) return digits;
  digits = digits.padStart(value.scale + 1, '0');
  const split = digits.length - value.scale;
  const formatted = `${digits.slice(0, split)}.${digits.slice(split)}`;
  return formatted.replace(/\.?0+$/, '');
}

export function normalizeSpotDecimal(value: string, fieldName = 'decimal'): string {
  return formatDecimal(parseDecimal(value, fieldName));
}

export function compareSpotDecimals(left: string, right: string): -1 | 0 | 1 {
  const a = parseDecimal(left, 'left', MAX_COMPUTED_DECIMAL_CHARACTERS);
  const b = parseDecimal(right, 'right', MAX_COMPUTED_DECIMAL_CHARACTERS);
  const scale = Math.max(a.scale, b.scale);
  const aCoefficient = rescale(a, scale);
  const bCoefficient = rescale(b, scale);
  return aCoefficient < bCoefficient ? -1 : aCoefficient > bCoefficient ? 1 : 0;
}

export function addSpotDecimals(left: string, right: string): string {
  const a = parseDecimal(left, 'left');
  const b = parseDecimal(right, 'right');
  const scale = Math.max(a.scale, b.scale);
  return formatDecimal({
    coefficient: rescale(a, scale) + rescale(b, scale),
    scale,
  });
}

export function subtractSpotDecimals(left: string, right: string): string {
  const a = parseDecimal(left, 'left');
  const b = parseDecimal(right, 'right');
  const scale = Math.max(a.scale, b.scale);
  const difference = rescale(a, scale) - rescale(b, scale);
  if (difference < 0n) {
    throw new RangeError('Spot decimal subtraction cannot produce a negative value');
  }
  return formatDecimal({ coefficient: difference, scale });
}

export function multiplySpotDecimals(left: string, right: string): string {
  const a = parseDecimal(left, 'left');
  const b = parseDecimal(right, 'right');
  return formatDecimal({
    coefficient: a.coefficient * b.coefficient,
    scale: a.scale + b.scale,
  });
}

function isZero(value: string): boolean {
  return parseDecimal(value, 'decimal').coefficient === 0n;
}

function isAligned(value: string, increment: string): boolean {
  const amount = parseDecimal(value, 'value');
  const step = parseDecimal(increment, 'increment');
  if (step.coefficient === 0n) return true;
  const scale = Math.max(amount.scale, step.scale);
  return rescale(amount, scale) % rescale(step, scale) === 0n;
}

export interface BinanceSpotPriceFilter {
  readonly filterType: 'PRICE_FILTER';
  readonly minPrice: string;
  readonly maxPrice: string;
  readonly tickSize: string;
}

/**
 * Current side-aware percent-price rule. A BUY order is bounded by the bid
 * multipliers and a SELL order by the ask multipliers, both inclusive, applied
 * to a venue reference price supplied separately from the snapshot.
 */
export interface BinanceSpotPercentPriceBySideFilter {
  readonly filterType: 'PERCENT_PRICE_BY_SIDE';
  readonly bidMultiplierUp: string;
  readonly bidMultiplierDown: string;
  readonly askMultiplierUp: string;
  readonly askMultiplierDown: string;
  readonly avgPriceMins: number;
}

export interface BinanceSpotLotSizeFilter {
  readonly filterType: 'LOT_SIZE';
  readonly minQty: string;
  readonly maxQty: string;
  readonly stepSize: string;
}

export interface BinanceSpotMarketLotSizeFilter {
  readonly filterType: 'MARKET_LOT_SIZE';
  readonly minQty: string;
  readonly maxQty: string;
  readonly stepSize: string;
}

export interface BinanceSpotMinNotionalFilter {
  readonly filterType: 'MIN_NOTIONAL';
  readonly minNotional: string;
  readonly applyToMarket: boolean;
  readonly avgPriceMins: number;
}

export interface BinanceSpotNotionalFilter {
  readonly filterType: 'NOTIONAL';
  readonly minNotional: string;
  readonly applyMinToMarket: boolean;
  readonly maxNotional: string;
  readonly applyMaxToMarket: boolean;
  readonly avgPriceMins: number;
}

export type BinanceSpotExecutionFilter =
  | BinanceSpotPriceFilter
  | BinanceSpotPercentPriceBySideFilter
  | BinanceSpotLotSizeFilter
  | BinanceSpotMarketLotSizeFilter
  | BinanceSpotMinNotionalFilter
  | BinanceSpotNotionalFilter;

export type BinanceSpotOrderSide = 'BUY' | 'SELL';

export interface BinanceSpotFilterOrder {
  readonly type: 'LIMIT' | 'MARKET';
  /** Required: side-aware rules cannot be answered without it. */
  readonly side: BinanceSpotOrderSide;
  /** Base-asset quantity. Quote-order-quantity orders are outside this contract. */
  readonly quantity: string;
  readonly price: string | null;
  readonly stopPrice?: string | null;
}

/**
 * The only PRICE_RANGE rule shape this module implements. Any other published
 * rule type is rejected rather than approximated.
 */
export const BINANCE_SPOT_EXECUTION_RULE_TYPES = ['PRICE_RANGE'] as const;

export type BinanceSpotExecutionRuleType =
  (typeof BINANCE_SPOT_EXECUTION_RULE_TYPES)[number];

/**
 * Separately published PRICE_RANGE rule. Documented disabling is preserved at
 * three independent levels: an absent rule, an absent reference price, and an
 * absent individual bound each disable exactly their own scope and nothing
 * wider. Present-but-unusable values are evidence corruption, not disabling.
 */
export interface BinanceSpotPriceRangeRule {
  readonly ruleType: 'PRICE_RANGE';
  readonly bidLimitMultUp?: string;
  readonly bidLimitMultDown?: string;
  readonly askLimitMultUp?: string;
  readonly askLimitMultDown?: string;
}

export type BinanceSpotReferencePriceEvidence =
  | {
      readonly state: 'SET';
      readonly price: string;
      /** Exact `timestamp` from the public referencePrice response. */
      readonly providerTimestampMs: number;
    }
  | {
      readonly state: 'NULL';
      /** Exact `timestamp` from the public referencePrice response. */
      readonly providerTimestampMs: number;
    }
  | {
      readonly state: 'NEVER_SET';
      readonly errorCode: -2043;
    };

/**
 * Public fallback price evidence. It is consulted only when referencePrice is
 * NULL or NEVER_SET.
 */
export type BinanceSpotFallbackPriceEvidence =
  | {
      readonly basis: 'VWAP';
      readonly price: string;
      readonly windowMins: number;
      readonly providerCloseTimeMs: number;
    }
  | {
      readonly basis: 'LAST_PRICE';
      readonly price: string;
      /** Local retrieval time; the public ticker response has no timestamp. */
      readonly retrievedAtMs: number;
      /** Non-null only when a time-bearing public last-trade source was used. */
      readonly providerTimestampMs: number | null;
    };

/**
 * Venue-owned public evidence. Every field records what the venue returned,
 * never what the ticket assumes.
 */
export interface BinanceSpotVenueEvidence {
  readonly referencePrice: Readonly<BinanceSpotReferencePriceEvidence>;
  /**
   * Zero or more distinct fallback windows. Multiple VWAP windows are allowed
   * because concurrently published filters can require different avgPriceMins.
   * This must be empty when referencePrice.state is SET.
   */
  readonly fallbackPrices:
    readonly Readonly<BinanceSpotFallbackPriceEvidence>[];
  /** Exact inner `rules` array from the symbol's executionRules row. */
  readonly executionRules: readonly unknown[];
}

/**
 * Compatibility-only reading of PRICE_RANGE. Multipliers are not current
 * executable bounds: Binance recalculates the reference price and fixes limits
 * only when an order enters its taker phase.
 */
export interface BinanceSpotPriceRangeCompatibility {
  readonly rulePresent: boolean;
  readonly side: BinanceSpotOrderSide;
  readonly limitMultiplierDown: string | null;
  readonly limitMultiplierUp: string | null;
  readonly referencePriceState: 'SET' | 'NULL' | 'NEVER_SET' | 'UNKNOWN';
  readonly enforcementPhase: 'TAKER_EXECUTION';
  readonly outOfRangeOutcome: 'EXPIRED_EXECUTION_RULE_PRICE_RANGE_EXCEEDED';
  readonly venueAcceptance: 'NOT_CLAIMED';
}

export const BINANCE_SPOT_FILTER_FAILURE_CODES = [
  'INVALID_ORDER',
  'MALFORMED_FILTER',
  'UNSUPPORTED_FILTER',
  'DUPLICATE_FILTER',
  'MISSING_PRICE_FILTER',
  'MISSING_LOT_SIZE_FILTER',
  'MISSING_NOTIONAL_FILTER',
  'MISSING_MARKET_REFERENCE_PRICE',
  'MISSING_PERCENT_PRICE_REFERENCE',
  'VENUE_EVIDENCE_INVALID',
  'PRICE_BELOW_MIN',
  'PRICE_ABOVE_MAX',
  'PRICE_TICK_MISMATCH',
  'PRICE_BELOW_PERCENT_BOUND',
  'PRICE_ABOVE_PERCENT_BOUND',
  'PRICE_RANGE_EVIDENCE_INVALID',
  'PRICE_RANGE_RULE_UNSUPPORTED',
  'PRICE_RANGE_RULE_DUPLICATE',
  'QUANTITY_BELOW_MIN',
  'QUANTITY_ABOVE_MAX',
  'QUANTITY_STEP_MISMATCH',
  'NOTIONAL_BELOW_MIN',
  'NOTIONAL_ABOVE_MAX',
] as const;

export type BinanceSpotFilterFailureCode =
  (typeof BINANCE_SPOT_FILTER_FAILURE_CODES)[number];

export interface BinanceSpotFilterFailure {
  readonly code: BinanceSpotFilterFailureCode;
  /**
   * The venue-provided filter name is retained for fail-closed diagnostics,
   * including filter families this validator does not implement.
   */
  readonly filterType: string;
  readonly field: string;
  readonly observed: string | null;
  readonly limit: string | null;
}

export interface BinanceSpotFilterValidation {
  readonly ok: boolean;
  /**
   * LIMIT notional or the greatest exact notional from all applicable MARKET
   * windows. MARKET filters are still evaluated against their own window;
   * the conservative maximum keeps downstream ticket/risk binding closed.
   */
  readonly notional: string | null;
  /** Null only when the order was rejected before any side was established. */
  readonly priceRange: Readonly<BinanceSpotPriceRangeCompatibility> | null;
  readonly failures: readonly Readonly<BinanceSpotFilterFailure>[];
}

function failure(
  code: BinanceSpotFilterFailureCode,
  filterType: BinanceSpotFilterFailure['filterType'],
  field: string,
  observed: string | null,
  limit: string | null,
): Readonly<BinanceSpotFilterFailure> {
  return Object.freeze({ code, filterType, field, observed, limit });
}

function decimalField(
  candidate: Record<string, unknown>,
  field: string,
  filterType: string,
  failures: BinanceSpotFilterFailure[],
): string | null {
  try {
    return normalizeSpotDecimal(candidate[field] as string, `${filterType}.${field}`);
  } catch {
    failures.push(failure('MALFORMED_FILTER', filterType, field, null, null));
    return null;
  }
}

/**
 * Read a strictly positive multiplier. Zero disables only the independently
 * documented Spot price-filter fields, so a zero multiplier is corruption of
 * the rule rather than a request to ignore it.
 */
function multiplierField(
  candidate: Record<string, unknown>,
  field: string,
  filterType: string,
  code: BinanceSpotFilterFailureCode,
  failures: BinanceSpotFilterFailure[],
): string | null {
  let normalized: string;
  try {
    normalized = normalizeSpotDecimal(
      candidate[field] as string,
      `${filterType}.${field}`,
    );
  } catch {
    failures.push(failure(code, filterType, field, null, 'positive decimal'));
    return null;
  }
  if (isZero(normalized)) {
    failures.push(failure(code, filterType, field, normalized, '>0'));
    return null;
  }
  return normalized;
}

function integerFieldValid(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function unknownOwnKey(
  candidate: Record<string, unknown>,
  allowed: readonly string[],
): string | null {
  const unknown = Reflect.ownKeys(candidate).find(
    (key) => typeof key !== 'string' || !allowed.includes(key),
  );
  return unknown === undefined
    ? null
    : typeof unknown === 'string'
      ? unknown
      : String(unknown);
}

function rejectUnknownOwnKey(
  candidate: Record<string, unknown>,
  allowed: readonly string[],
  filterType: string,
  code: BinanceSpotFilterFailureCode,
  failures: BinanceSpotFilterFailure[],
): void {
  const key = unknownOwnKey(candidate, allowed);
  if (key !== null) {
    failures.push(
      failure(code, filterType, 'unknownField', key, allowed.join('|')),
    );
  }
}

function validateRangeDefinition(
  min: string | null,
  max: string | null,
  filterType: BinanceSpotExecutionFilter['filterType'],
  failures: BinanceSpotFilterFailure[],
): void {
  if (
    min !== null &&
    max !== null &&
    !isZero(min) &&
    !isZero(max) &&
    compareSpotDecimals(min, max) > 0
  ) {
    failures.push(failure('MALFORMED_FILTER', filterType, 'range', min, max));
  }
}

function checkBoundedIncrement(
  value: string,
  min: string,
  max: string,
  increment: string,
  filterType: 'PRICE_FILTER' | 'LOT_SIZE' | 'MARKET_LOT_SIZE',
  field: 'price' | 'stopPrice' | 'quantity',
  failures: BinanceSpotFilterFailure[],
): void {
  const price = filterType === 'PRICE_FILTER';
  if (!isZero(min) && compareSpotDecimals(value, min) < 0) {
    failures.push(
      failure(
        price ? 'PRICE_BELOW_MIN' : 'QUANTITY_BELOW_MIN',
        filterType,
        field,
        value,
        min,
      ),
    );
  }
  if (!isZero(max) && compareSpotDecimals(value, max) > 0) {
    failures.push(
      failure(
        price ? 'PRICE_ABOVE_MAX' : 'QUANTITY_ABOVE_MAX',
        filterType,
        field,
        value,
        max,
      ),
    );
  }
  if (!isZero(increment) && !isAligned(value, increment)) {
    failures.push(
      failure(
        price ? 'PRICE_TICK_MISMATCH' : 'QUANTITY_STEP_MISMATCH',
        filterType,
        field,
        value,
        increment,
      ),
    );
  }
}

function freezeValidation(
  failures: BinanceSpotFilterFailure[],
  notional: string | null,
  priceRange: Readonly<BinanceSpotPriceRangeCompatibility> | null,
): Readonly<BinanceSpotFilterValidation> {
  const frozenFailures = Object.freeze(
    failures.map((item) => Object.freeze({ ...item })),
  );
  return Object.freeze({
    ok: frozenFailures.length === 0,
    notional,
    priceRange,
    failures: frozenFailures,
  });
}

const PERCENT_PRICE_MULTIPLIER_FIELDS = Object.freeze([
  'bidMultiplierUp',
  'bidMultiplierDown',
  'askMultiplierUp',
  'askMultiplierDown',
] as const);

const PRICE_RANGE_MULTIPLIER_FIELDS = Object.freeze([
  'bidLimitMultUp',
  'bidLimitMultDown',
  'askLimitMultUp',
  'askLimitMultDown',
] as const);

const MULTIPLIER_SIDE_PREFIXES = Object.freeze(['bid', 'ask'] as const);

/** BUY orders read the bid multipliers and SELL orders read the ask ones. */
function sidePrefix(side: BinanceSpotOrderSide): 'bid' | 'ask' {
  return side === 'BUY' ? 'bid' : 'ask';
}

interface ParsedReferencePriceEvidence {
  readonly state: 'SET' | 'NULL' | 'NEVER_SET';
  readonly price: string | null;
}

interface ParsedFallbackPriceEvidence {
  readonly basis: 'VWAP' | 'LAST_PRICE';
  readonly price: string;
  readonly windowMins: number;
}

/**
 * Reference-first price evidence as parsed for one validation. A null
 * `referencePrice` means the evidence was absent or unusable here, which is
 * never the same as the venue itself reporting a null reference.
 */
interface ParsedVenuePrices {
  readonly referencePrice: Readonly<ParsedReferencePriceEvidence> | null;
  readonly fallbackPrices: readonly Readonly<ParsedFallbackPriceEvidence>[];
}

const NO_VENUE_PRICES: Readonly<ParsedVenuePrices> = Object.freeze({
  referencePrice: null,
  fallbackPrices: Object.freeze([]),
});

function parseReferencePriceEvidence(
  value: unknown,
  failures: BinanceSpotFilterFailure[],
): Readonly<ParsedReferencePriceEvidence> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    failures.push(
      failure(
        'VENUE_EVIDENCE_INVALID',
        'REFERENCE_PRICE',
        'referencePrice',
        null,
        'object',
      ),
    );
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.state === 'SET') {
    rejectUnknownOwnKey(
      candidate,
      ['state', 'price', 'providerTimestampMs'],
      'REFERENCE_PRICE',
      'VENUE_EVIDENCE_INVALID',
      failures,
    );
    if (!integerFieldValid(candidate.providerTimestampMs)) {
      failures.push(
        failure(
          'VENUE_EVIDENCE_INVALID',
          'REFERENCE_PRICE',
          'providerTimestampMs',
          null,
          'non-negative safe integer',
        ),
      );
    }
    const price = multiplierField(
      candidate,
      'price',
      'REFERENCE_PRICE',
      'VENUE_EVIDENCE_INVALID',
      failures,
    );
    return price === null
      ? null
      : Object.freeze({ state: 'SET' as const, price });
  }
  if (candidate.state === 'NULL') {
    rejectUnknownOwnKey(
      candidate,
      ['state', 'providerTimestampMs'],
      'REFERENCE_PRICE',
      'VENUE_EVIDENCE_INVALID',
      failures,
    );
    if (!integerFieldValid(candidate.providerTimestampMs)) {
      failures.push(
        failure(
          'VENUE_EVIDENCE_INVALID',
          'REFERENCE_PRICE',
          'providerTimestampMs',
          null,
          'non-negative safe integer',
        ),
      );
    }
    return Object.freeze({ state: 'NULL' as const, price: null });
  }
  if (candidate.state === 'NEVER_SET') {
    rejectUnknownOwnKey(
      candidate,
      ['state', 'errorCode'],
      'REFERENCE_PRICE',
      'VENUE_EVIDENCE_INVALID',
      failures,
    );
    if (candidate.errorCode !== -2043) {
      failures.push(
        failure(
          'VENUE_EVIDENCE_INVALID',
          'REFERENCE_PRICE',
          'errorCode',
          typeof candidate.errorCode === 'number'
            ? String(candidate.errorCode)
            : null,
          '-2043',
        ),
      );
      return null;
    }
    return Object.freeze({ state: 'NEVER_SET' as const, price: null });
  }
  failures.push(
    failure(
      'VENUE_EVIDENCE_INVALID',
      'REFERENCE_PRICE',
      'state',
      typeof candidate.state === 'string' ? candidate.state : null,
      'SET|NULL|NEVER_SET',
    ),
  );
  return null;
}

function parseFallbackPriceEvidence(
  value: unknown,
  failures: BinanceSpotFilterFailure[],
): Readonly<ParsedFallbackPriceEvidence> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    failures.push(
      failure(
        'VENUE_EVIDENCE_INVALID',
        'FALLBACK_PRICE',
        'entry',
        null,
        'object',
      ),
    );
    return null;
  }
  const candidate = value as Record<string, unknown>;
  let windowMins: number;
  if (candidate.basis === 'VWAP') {
    rejectUnknownOwnKey(
      candidate,
      ['basis', 'price', 'windowMins', 'providerCloseTimeMs'],
      'FALLBACK_PRICE',
      'VENUE_EVIDENCE_INVALID',
      failures,
    );
    if (
      !Number.isSafeInteger(candidate.windowMins) ||
      (candidate.windowMins as number) <= 0
    ) {
      failures.push(
        failure(
          'VENUE_EVIDENCE_INVALID',
          'FALLBACK_PRICE',
          'windowMins',
          null,
          'positive safe integer',
        ),
      );
      return null;
    }
    if (!integerFieldValid(candidate.providerCloseTimeMs)) {
      failures.push(
        failure(
          'VENUE_EVIDENCE_INVALID',
          'FALLBACK_PRICE',
          'providerCloseTimeMs',
          null,
          'non-negative safe integer',
        ),
      );
    }
    windowMins = candidate.windowMins as number;
  } else if (candidate.basis === 'LAST_PRICE') {
    rejectUnknownOwnKey(
      candidate,
      ['basis', 'price', 'retrievedAtMs', 'providerTimestampMs'],
      'FALLBACK_PRICE',
      'VENUE_EVIDENCE_INVALID',
      failures,
    );
    if (!integerFieldValid(candidate.retrievedAtMs)) {
      failures.push(
        failure(
          'VENUE_EVIDENCE_INVALID',
          'FALLBACK_PRICE',
          'retrievedAtMs',
          null,
          'non-negative safe integer',
        ),
      );
    }
    if (
      candidate.providerTimestampMs !== null &&
      !integerFieldValid(candidate.providerTimestampMs)
    ) {
      failures.push(
        failure(
          'VENUE_EVIDENCE_INVALID',
          'FALLBACK_PRICE',
          'providerTimestampMs',
          null,
          'non-negative safe integer|null',
        ),
      );
    }
    windowMins = 0;
  } else {
    failures.push(
      failure(
        'VENUE_EVIDENCE_INVALID',
        'FALLBACK_PRICE',
        'basis',
        typeof candidate.basis === 'string' ? candidate.basis : null,
        'VWAP|LAST_PRICE',
      ),
    );
    return null;
  }
  const price = multiplierField(
    candidate,
    'price',
    'FALLBACK_PRICE',
    'VENUE_EVIDENCE_INVALID',
    failures,
  );
  return price === null
    ? null
    : Object.freeze({
        basis: candidate.basis as 'VWAP' | 'LAST_PRICE',
        price,
        windowMins,
      });
}

function parseFallbackPriceEvidenceSet(
  value: unknown,
  failures: BinanceSpotFilterFailure[],
): readonly Readonly<ParsedFallbackPriceEvidence>[] {
  if (!Array.isArray(value) || value.length > 32) {
    failures.push(
      failure(
        'VENUE_EVIDENCE_INVALID',
        'FALLBACK_PRICE',
        'fallbackPrices',
        null,
        'array length 0..32',
      ),
    );
    return Object.freeze([]);
  }
  const parsed = value
    .map((candidate) => parseFallbackPriceEvidence(candidate, failures))
    .filter(
      (candidate): candidate is Readonly<ParsedFallbackPriceEvidence> =>
        candidate !== null,
    );
  const keys = parsed.map((candidate) =>
    candidate.basis === 'VWAP'
      ? `VWAP:${String(candidate.windowMins)}`
      : 'LAST_PRICE:0',
  );
  if (new Set(keys).size !== keys.length) {
    failures.push(
      failure(
        'VENUE_EVIDENCE_INVALID',
        'FALLBACK_PRICE',
        'duplicate',
        null,
        'unique basis/window',
      ),
    );
  }
  return Object.freeze(parsed);
}

/**
 * Current venue price selection: a non-null published reference price answers
 * every window, and only when it is null or never set does the filter's own
 * avgPriceMins decide between an exact VWAP window and the last price at 0.
 */
function filterPriceForWindow(
  prices: Readonly<ParsedVenuePrices>,
  avgPriceMins: number,
  filterType: 'PERCENT_PRICE_BY_SIDE' | 'MIN_NOTIONAL' | 'NOTIONAL',
  missingCode:
    | 'MISSING_PERCENT_PRICE_REFERENCE'
    | 'MISSING_MARKET_REFERENCE_PRICE',
  failures: BinanceSpotFilterFailure[],
): string | null {
  const { referencePrice, fallbackPrices } = prices;
  if (referencePrice?.state === 'SET') return referencePrice.price;
  const fallback = fallbackPrices.find(
    (candidate) =>
      (candidate.basis === 'VWAP' &&
        avgPriceMins > 0 &&
        candidate.windowMins === avgPriceMins) ||
      (candidate.basis === 'LAST_PRICE' && avgPriceMins === 0),
  );
  if (fallback !== undefined) return fallback.price;
  failures.push(
    failure(
      missingCode,
      filterType,
      'avgPriceMins',
      fallbackPrices.length === 0
        ? null
        : fallbackPrices
            .map((candidate) =>
              `${candidate.basis}:${String(candidate.windowMins)}`,
            )
            .join('|'),
      String(avgPriceMins),
    ),
  );
  return null;
}

/**
 * Exact inclusive PERCENT_PRICE_BY_SIDE admission. Both sides of the published
 * rule are checked for corruption, and only the order's own side is applied.
 */
function checkPercentPriceBySide(
  filter: Record<string, unknown>,
  side: BinanceSpotOrderSide,
  prices: Readonly<ParsedVenuePrices>,
  price: string | null,
  failures: BinanceSpotFilterFailure[],
): void {
  const multipliers: Record<string, string | null> = {};
  for (const field of PERCENT_PRICE_MULTIPLIER_FIELDS) {
    multipliers[field] = multiplierField(
      filter,
      field,
      'PERCENT_PRICE_BY_SIDE',
      'MALFORMED_FILTER',
      failures,
    );
  }
  const avgPriceMinsValid = integerFieldValid(filter.avgPriceMins);
  if (!avgPriceMinsValid) {
    failures.push(
      failure(
        'MALFORMED_FILTER',
        'PERCENT_PRICE_BY_SIDE',
        'avgPriceMins',
        null,
        'non-negative integer',
      ),
    );
  }
  for (const prefix of MULTIPLIER_SIDE_PREFIXES) {
    const up = multipliers[`${prefix}MultiplierUp`];
    const down = multipliers[`${prefix}MultiplierDown`];
    if (up !== null && down !== null && compareSpotDecimals(down, up) > 0) {
      failures.push(
        failure(
          'MALFORMED_FILTER',
          'PERCENT_PRICE_BY_SIDE',
          `${prefix}MultiplierRange`,
          down,
          up,
        ),
      );
      multipliers[`${prefix}MultiplierUp`] = null;
      multipliers[`${prefix}MultiplierDown`] = null;
    }
  }

  const prefix = sidePrefix(side);
  const up = multipliers[`${prefix}MultiplierUp`];
  const down = multipliers[`${prefix}MultiplierDown`];
  // MARKET orders carry no submitted price for this admission filter.
  if (price === null || up === null || down === null || !avgPriceMinsValid) {
    return;
  }
  const referencePrice = filterPriceForWindow(
    prices,
    filter.avgPriceMins as number,
    'PERCENT_PRICE_BY_SIDE',
    'MISSING_PERCENT_PRICE_REFERENCE',
    failures,
  );
  if (referencePrice === null) return;
  const upper = multiplySpotDecimals(referencePrice, up);
  const lower = multiplySpotDecimals(referencePrice, down);
  if (compareSpotDecimals(price, lower) < 0) {
    failures.push(
      failure(
        'PRICE_BELOW_PERCENT_BOUND',
        'PERCENT_PRICE_BY_SIDE',
        'price',
        price,
        lower,
      ),
    );
  }
  if (compareSpotDecimals(price, upper) > 0) {
    failures.push(
      failure(
        'PRICE_ABOVE_PERCENT_BOUND',
        'PERCENT_PRICE_BY_SIDE',
        'price',
        price,
        upper,
      ),
    );
  }
}

function priceRangeCompatibility(
  side: BinanceSpotOrderSide,
  rulePresent: boolean,
  limitMultiplierDown: string | null,
  limitMultiplierUp: string | null,
  referencePriceState:
    | 'SET'
    | 'NULL'
    | 'NEVER_SET'
    | 'UNKNOWN',
): Readonly<BinanceSpotPriceRangeCompatibility> {
  return Object.freeze({
    rulePresent,
    side,
    limitMultiplierDown,
    limitMultiplierUp,
    referencePriceState,
    enforcementPhase: 'TAKER_EXECUTION' as const,
    outOfRangeOutcome:
      'EXPIRED_EXECUTION_RULE_PRICE_RANGE_EXCEEDED' as const,
    venueAcceptance: 'NOT_CLAIMED' as const,
  });
}

/**
 * Recognize the separately published PRICE_RANGE rule without turning a
 * validation-time snapshot into an execution-time acceptance claim.
 */
function evaluatePriceRange(
  executionRules: readonly unknown[],
  prices: Readonly<ParsedVenuePrices>,
  side: BinanceSpotOrderSide,
  failures: BinanceSpotFilterFailure[],
): Readonly<BinanceSpotPriceRangeCompatibility> {
  // UNKNOWN is reserved for evidence this validation could not read; the venue's
  // own NULL and NEVER_SET answers are reported as themselves.
  const referencePriceState = prices.referencePrice?.state ?? 'UNKNOWN';
  let priceRangeRule: Record<string, unknown> | null = null;
  for (const candidate of executionRules) {
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      failures.push(
        failure(
          'PRICE_RANGE_EVIDENCE_INVALID',
          'EXECUTION_RULE_SET',
          'entry',
          null,
          'object',
        ),
      );
      continue;
    }
    const record = candidate as Record<string, unknown>;
    rejectUnknownOwnKey(
      record,
      ['ruleType', ...PRICE_RANGE_MULTIPLIER_FIELDS],
      'PRICE_RANGE',
      'PRICE_RANGE_EVIDENCE_INVALID',
      failures,
    );
    const ruleType = record.ruleType;
    if (
      typeof ruleType !== 'string' ||
      !(BINANCE_SPOT_EXECUTION_RULE_TYPES as readonly string[]).includes(
        ruleType,
      )
    ) {
      failures.push(
        failure(
          'PRICE_RANGE_RULE_UNSUPPORTED',
          typeof ruleType === 'string' ? ruleType : 'EXECUTION_RULE_SET',
          'ruleType',
          typeof ruleType === 'string' ? ruleType : null,
          BINANCE_SPOT_EXECUTION_RULE_TYPES.join('|'),
        ),
      );
      continue;
    }
    if (priceRangeRule !== null) {
      failures.push(
        failure(
          'PRICE_RANGE_RULE_DUPLICATE',
          'PRICE_RANGE',
          'ruleType',
          ruleType,
          null,
        ),
      );
      continue;
    }
    priceRangeRule = record;
  }
  if (priceRangeRule === null) {
    return priceRangeCompatibility(
      side,
      false,
      null,
      null,
      referencePriceState,
    );
  }

  const multipliers: Record<string, string | null> = {};
  for (const field of PRICE_RANGE_MULTIPLIER_FIELDS) {
    const supplied = priceRangeRule[field];
    multipliers[field] =
      supplied === undefined
        ? null
        : multiplierField(
            priceRangeRule,
            field,
            'PRICE_RANGE',
            'PRICE_RANGE_EVIDENCE_INVALID',
            failures,
          );
  }
  for (const prefix of MULTIPLIER_SIDE_PREFIXES) {
    const up = multipliers[`${prefix}LimitMultUp`];
    const down = multipliers[`${prefix}LimitMultDown`];
    if (up !== null && down !== null && compareSpotDecimals(down, up) > 0) {
      failures.push(
        failure(
          'PRICE_RANGE_EVIDENCE_INVALID',
          'PRICE_RANGE',
          `${prefix}LimitMultRange`,
          down,
          up,
        ),
      );
      multipliers[`${prefix}LimitMultUp`] = null;
      multipliers[`${prefix}LimitMultDown`] = null;
    }
  }

  const prefix = sidePrefix(side);
  const up = multipliers[`${prefix}LimitMultUp`];
  const down = multipliers[`${prefix}LimitMultDown`];
  return priceRangeCompatibility(
    side,
    true,
    down,
    up,
    referencePriceState,
  );
}

/**
 * Fail-closed validation over a canonical supported filter set. Every entry in
 * a venue filter snapshot is a send constraint: an unknown or locally
 * unimplemented filter is rejected rather than guessed or silently ignored.
 * Duplicate or malformed supported filters are also rejected. The required
 * PRICE_FILTER, LOT_SIZE, and at least one notional filter must be present.
 *
 * `venueEvidence` carries what the venue currently says rather than what the
 * caller intends to send, and stays separate from the exchangeInfo snapshot.
 */
export function validateBinanceSpotOrderFilters(
  order: BinanceSpotFilterOrder,
  filters: readonly unknown[],
  venueEvidence: Readonly<BinanceSpotVenueEvidence> | null = null,
): Readonly<BinanceSpotFilterValidation> {
  const failures: BinanceSpotFilterFailure[] = [];
  if (
    order === null ||
    typeof order !== 'object' ||
    (order.type !== 'LIMIT' && order.type !== 'MARKET')
  ) {
    return freezeValidation(
      [failure('INVALID_ORDER', 'ORDER', 'type', null, null)],
      null,
      null,
    );
  }
  if (order.side !== 'BUY' && order.side !== 'SELL') {
    return freezeValidation(
      [failure('INVALID_ORDER', 'ORDER', 'side', null, 'BUY|SELL')],
      null,
      null,
    );
  }
  const side = order.side;

  let quantity: string;
  let price: string | null = null;
  let stopPrice: string | null = null;
  try {
    quantity = normalizeSpotDecimal(order.quantity, 'order.quantity');
    if (isZero(quantity)) throw new TypeError('order.quantity must be positive');
    if (order.type === 'LIMIT') {
      if (order.price === null) throw new TypeError('LIMIT price is required');
      price = normalizeSpotDecimal(order.price, 'order.price');
      if (isZero(price)) throw new TypeError('LIMIT price must be positive');
    } else if (order.price !== null) {
      throw new TypeError('MARKET price must be null');
    }
    if (order.stopPrice !== undefined && order.stopPrice !== null) {
      stopPrice = normalizeSpotDecimal(order.stopPrice, 'order.stopPrice');
      if (isZero(stopPrice)) throw new TypeError('stopPrice must be positive');
    }
  } catch {
    return freezeValidation(
      [failure('INVALID_ORDER', 'ORDER', 'decimal', null, null)],
      null,
      null,
    );
  }

  let venuePrices: Readonly<ParsedVenuePrices> = NO_VENUE_PRICES;
  let executionRules: readonly unknown[] = Object.freeze([]);
  if (venueEvidence !== null) {
    if (typeof venueEvidence !== 'object' || Array.isArray(venueEvidence)) {
      failures.push(
        failure('VENUE_EVIDENCE_INVALID', 'VENUE_EVIDENCE', 'evidence', null, 'object'),
      );
    } else {
      const record = venueEvidence as unknown as Record<string, unknown>;
      rejectUnknownOwnKey(
        record,
        ['referencePrice', 'fallbackPrices', 'executionRules'],
        'VENUE_EVIDENCE',
        'VENUE_EVIDENCE_INVALID',
        failures,
      );
      const referencePrice = parseReferencePriceEvidence(
        record.referencePrice,
        failures,
      );
      const fallbackPrices = parseFallbackPriceEvidenceSet(
        record.fallbackPrices,
        failures,
      );
      // A non-null reference price answers every window on its own, so carrying
      // fallbacks beside it is ambiguous evidence rather than extra coverage.
      if (referencePrice?.state === 'SET' && fallbackPrices.length > 0) {
        failures.push(
          failure(
            'VENUE_EVIDENCE_INVALID',
            'VENUE_EVIDENCE',
            'fallbackPrices',
            String(fallbackPrices.length),
            'empty while referencePrice is SET',
          ),
        );
      }
      venuePrices = Object.freeze({ referencePrice, fallbackPrices });
      if (
        !Array.isArray(venueEvidence.executionRules) ||
        venueEvidence.executionRules.length > 32
      ) {
        failures.push(
          failure(
            'VENUE_EVIDENCE_INVALID',
            'VENUE_EVIDENCE',
            'executionRules',
            null,
            'array length 0..32',
          ),
        );
      } else {
        executionRules = venueEvidence.executionRules;
      }
    }
  }

  const supported = new Map<
    BinanceSpotExecutionFilter['filterType'],
    Record<string, unknown>
  >();
  for (const candidate of Array.isArray(filters) ? filters : []) {
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      failures.push(
        failure('MALFORMED_FILTER', 'FILTER_SET', 'entry', null, 'object'),
      );
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const type = record.filterType;
    if (typeof type !== 'string' || type.length === 0) {
      failures.push(
        failure(
          'MALFORMED_FILTER',
          'FILTER_SET',
          'filterType',
          typeof type === 'string' ? type : null,
          'non-empty string',
        ),
      );
      continue;
    }
    if (
      type !== 'PRICE_FILTER' &&
      type !== 'PERCENT_PRICE_BY_SIDE' &&
      type !== 'LOT_SIZE' &&
      type !== 'MARKET_LOT_SIZE' &&
      type !== 'MIN_NOTIONAL' &&
      type !== 'NOTIONAL'
    ) {
      failures.push(
        failure(
          'UNSUPPORTED_FILTER',
          type,
          'filterType',
          type,
          'locally implemented filter',
        ),
      );
      continue;
    }
    const allowedKeys: Readonly<Record<
      BinanceSpotExecutionFilter['filterType'],
      readonly string[]
    >> = {
      PRICE_FILTER: ['filterType', 'minPrice', 'maxPrice', 'tickSize'],
      PERCENT_PRICE_BY_SIDE: [
        'filterType',
        'bidMultiplierUp',
        'bidMultiplierDown',
        'askMultiplierUp',
        'askMultiplierDown',
        'avgPriceMins',
      ],
      LOT_SIZE: ['filterType', 'minQty', 'maxQty', 'stepSize'],
      MARKET_LOT_SIZE: ['filterType', 'minQty', 'maxQty', 'stepSize'],
      MIN_NOTIONAL: [
        'filterType',
        'minNotional',
        'applyToMarket',
        'avgPriceMins',
      ],
      NOTIONAL: [
        'filterType',
        'minNotional',
        'applyMinToMarket',
        'maxNotional',
        'applyMaxToMarket',
        'avgPriceMins',
      ],
    };
    rejectUnknownOwnKey(
      record,
      allowedKeys[type],
      type,
      'MALFORMED_FILTER',
      failures,
    );
    if (supported.has(type)) {
      failures.push(failure('DUPLICATE_FILTER', type, 'filterType', type, null));
      continue;
    }
    supported.set(type, record);
  }

  if (!supported.has('PRICE_FILTER')) {
    failures.push(
      failure('MISSING_PRICE_FILTER', 'FILTER_SET', 'filterType', null, 'PRICE_FILTER'),
    );
  }
  if (!supported.has('LOT_SIZE')) {
    failures.push(
      failure('MISSING_LOT_SIZE_FILTER', 'FILTER_SET', 'filterType', null, 'LOT_SIZE'),
    );
  }
  if (!supported.has('MIN_NOTIONAL') && !supported.has('NOTIONAL')) {
    failures.push(
      failure(
        'MISSING_NOTIONAL_FILTER',
        'FILTER_SET',
        'filterType',
        null,
        'MIN_NOTIONAL|NOTIONAL',
      ),
    );
  }

  const priceFilter = supported.get('PRICE_FILTER');
  if (priceFilter !== undefined) {
    const min = decimalField(priceFilter, 'minPrice', 'PRICE_FILTER', failures);
    const max = decimalField(priceFilter, 'maxPrice', 'PRICE_FILTER', failures);
    const tick = decimalField(priceFilter, 'tickSize', 'PRICE_FILTER', failures);
    validateRangeDefinition(min, max, 'PRICE_FILTER', failures);
    if (min !== null && max !== null && tick !== null) {
      if (price !== null) {
        checkBoundedIncrement(
          price,
          min,
          max,
          tick,
          'PRICE_FILTER',
          'price',
          failures,
        );
      }
      if (stopPrice !== null) {
        checkBoundedIncrement(
          stopPrice,
          min,
          max,
          tick,
          'PRICE_FILTER',
          'stopPrice',
          failures,
        );
      }
    }
  }

  const percentPriceBySide = supported.get('PERCENT_PRICE_BY_SIDE');
  if (percentPriceBySide !== undefined) {
    checkPercentPriceBySide(
      percentPriceBySide,
      side,
      venuePrices,
      price,
      failures,
    );
  }

  const validateLot = (
    type: 'LOT_SIZE' | 'MARKET_LOT_SIZE',
    filter: Record<string, unknown>,
  ): void => {
    const min = decimalField(filter, 'minQty', type, failures);
    const max = decimalField(filter, 'maxQty', type, failures);
    const step = decimalField(filter, 'stepSize', type, failures);
    validateRangeDefinition(min, max, type, failures);
    if (max !== null && isZero(max)) {
      failures.push(failure('MALFORMED_FILTER', type, 'maxQty', max, '>0'));
    }
    // Current public MARKET_LOT_SIZE rows commonly publish numeric-zero min
    // and step fields. They carry no market-specific constraint; LOT_SIZE and
    // a nonzero MARKET_LOT_SIZE max remain independently active.
    if (
      step !== null &&
      isZero(step) &&
      type !== 'MARKET_LOT_SIZE'
    ) {
      failures.push(failure('MALFORMED_FILTER', type, 'stepSize', step, '>0'));
    }
    if (min !== null && max !== null && step !== null) {
      checkBoundedIncrement(
        quantity,
        min,
        max,
        step,
        type,
        'quantity',
        failures,
      );
    }
  };

  const lotSize = supported.get('LOT_SIZE');
  if (lotSize !== undefined) validateLot('LOT_SIZE', lotSize);
  const marketLotSize = supported.get('MARKET_LOT_SIZE');
  if (order.type === 'MARKET' && marketLotSize !== undefined) {
    validateLot('MARKET_LOT_SIZE', marketLotSize);
  }

  const minNotional = supported.get('MIN_NOTIONAL');
  const notional = supported.get('NOTIONAL');
  let computedNotional =
    order.type === 'LIMIT' && price !== null
      ? multiplySpotDecimals(quantity, price)
      : null;
  const marketNotionals = new Set<string>();

  const marketNotionalFor = (
    filterType: 'MIN_NOTIONAL' | 'NOTIONAL',
    avgPriceMins: unknown,
  ): string | null => {
    if (!integerFieldValid(avgPriceMins)) return null;
    const selectedPrice = filterPriceForWindow(
      venuePrices,
      avgPriceMins as number,
      filterType,
      'MISSING_MARKET_REFERENCE_PRICE',
      failures,
    );
    if (selectedPrice === null) return null;
    const value = multiplySpotDecimals(quantity, selectedPrice);
    marketNotionals.add(value);
    return value;
  };

  if (minNotional !== undefined) {
    const marketApplicationValid =
      typeof minNotional.applyToMarket === 'boolean' &&
      integerFieldValid(minNotional.avgPriceMins);
    if (!marketApplicationValid) {
      failures.push(
        failure('MALFORMED_FILTER', 'MIN_NOTIONAL', 'marketApplication', null, null),
      );
    }
    const min = decimalField(
      minNotional,
      'minNotional',
      'MIN_NOTIONAL',
      failures,
    );
    if (min !== null && isZero(min)) {
      failures.push(
        failure('MALFORMED_FILTER', 'MIN_NOTIONAL', 'minNotional', min, '>0'),
      );
    }
    const applies = order.type === 'LIMIT' || minNotional.applyToMarket === true;
    const filterNotional =
      order.type === 'MARKET' && applies && marketApplicationValid
        ? marketNotionalFor('MIN_NOTIONAL', minNotional.avgPriceMins)
        : computedNotional;
    if (
      applies &&
      min !== null &&
      filterNotional !== null &&
      compareSpotDecimals(filterNotional, min) < 0
    ) {
      failures.push(
        failure(
          'NOTIONAL_BELOW_MIN',
          'MIN_NOTIONAL',
          'notional',
          filterNotional,
          min,
        ),
      );
    }
  }

  if (notional !== undefined) {
    const marketApplicationValid =
      typeof notional.applyMinToMarket === 'boolean' &&
      typeof notional.applyMaxToMarket === 'boolean' &&
      integerFieldValid(notional.avgPriceMins);
    if (!marketApplicationValid) {
      failures.push(
        failure('MALFORMED_FILTER', 'NOTIONAL', 'marketApplication', null, null),
      );
    }
    const min = decimalField(notional, 'minNotional', 'NOTIONAL', failures);
    const max = decimalField(notional, 'maxNotional', 'NOTIONAL', failures);
    validateRangeDefinition(min, max, 'NOTIONAL', failures);
    if (min !== null && isZero(min)) {
      failures.push(
        failure('MALFORMED_FILTER', 'NOTIONAL', 'minNotional', min, '>0'),
      );
    }
    if (max !== null && isZero(max)) {
      failures.push(
        failure('MALFORMED_FILTER', 'NOTIONAL', 'maxNotional', max, '>0'),
      );
    }
    const minApplies = order.type === 'LIMIT' || notional.applyMinToMarket === true;
    const maxApplies = order.type === 'LIMIT' || notional.applyMaxToMarket === true;
    const filterNotional =
      order.type === 'MARKET' &&
      (minApplies || maxApplies) &&
      marketApplicationValid
        ? marketNotionalFor('NOTIONAL', notional.avgPriceMins)
        : computedNotional;
    if (
      minApplies &&
      min !== null &&
      filterNotional !== null &&
      compareSpotDecimals(filterNotional, min) < 0
    ) {
      failures.push(
        failure(
          'NOTIONAL_BELOW_MIN',
          'NOTIONAL',
          'notional',
          filterNotional,
          min,
        ),
      );
    }
    if (
      maxApplies &&
      max !== null &&
      filterNotional !== null &&
      compareSpotDecimals(filterNotional, max) > 0
    ) {
      failures.push(
        failure(
          'NOTIONAL_ABOVE_MAX',
          'NOTIONAL',
          'notional',
          filterNotional,
          max,
        ),
      );
    }
  }

  if (order.type === 'MARKET') {
    computedNotional = [...marketNotionals].reduce<string | null>(
      (greatest, candidate) =>
        greatest === null || compareSpotDecimals(candidate, greatest) > 0
          ? candidate
          : greatest,
      null,
    );
  }

  const priceRange = evaluatePriceRange(
    executionRules,
    venuePrices,
    side,
    failures,
  );

  return freezeValidation(failures, computedNotional, priceRange);
}
