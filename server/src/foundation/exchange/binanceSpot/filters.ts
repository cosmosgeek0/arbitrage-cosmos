/**
 * Exact Binance Spot symbol-filter validation for base-quantity orders.
 *
 * Supported current Spot filters:
 * PRICE_FILTER, LOT_SIZE, MARKET_LOT_SIZE, MIN_NOTIONAL, and NOTIONAL.
 * Callers supply the execution projection of the authority-owned normalized
 * instrument snapshot; this module does not fetch, normalize, version, or
 * persist an exchangeInfo registry.
 * MARKET notional checks require an explicitly injected venue reference
 * price; this module never fetches or guesses one.
 *
 * Pure module: no I/O, clocks, environment reads, or floating-point math.
 */

const PLAIN_DECIMAL = /^(?:0|[0-9]+)(?:\.[0-9]+)?$/;
const MAX_DECIMAL_CHARACTERS = 120;

interface ExactDecimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

function parseDecimal(value: unknown, fieldName: string): ExactDecimal {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_DECIMAL_CHARACTERS ||
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
  const a = parseDecimal(left, 'left');
  const b = parseDecimal(right, 'right');
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
  | BinanceSpotLotSizeFilter
  | BinanceSpotMarketLotSizeFilter
  | BinanceSpotMinNotionalFilter
  | BinanceSpotNotionalFilter;

export interface BinanceSpotFilterOrder {
  readonly type: 'LIMIT' | 'MARKET';
  /** Base-asset quantity. Quote-order-quantity orders are outside this contract. */
  readonly quantity: string;
  readonly price: string | null;
  readonly stopPrice?: string | null;
  /** Injected average/last/reference price used for MARKET notional checks. */
  readonly marketReferencePrice?: string | null;
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
  'PRICE_BELOW_MIN',
  'PRICE_ABOVE_MAX',
  'PRICE_TICK_MISMATCH',
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
  readonly notional: string | null;
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
  filterType: BinanceSpotExecutionFilter['filterType'],
  failures: BinanceSpotFilterFailure[],
): string | null {
  try {
    return normalizeSpotDecimal(candidate[field] as string, `${filterType}.${field}`);
  } catch {
    failures.push(failure('MALFORMED_FILTER', filterType, field, null, null));
    return null;
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
): Readonly<BinanceSpotFilterValidation> {
  const frozenFailures = Object.freeze(
    failures.map((item) => Object.freeze({ ...item })),
  );
  return Object.freeze({
    ok: frozenFailures.length === 0,
    notional,
    failures: frozenFailures,
  });
}

/**
 * Fail-closed validation over a canonical supported filter set. Every entry in
 * a venue filter snapshot is a send constraint: an unknown or locally
 * unimplemented filter is rejected rather than guessed or silently ignored.
 * Duplicate or malformed supported filters are also rejected. The required
 * PRICE_FILTER, LOT_SIZE, and at least one notional filter must be present.
 */
export function validateBinanceSpotOrderFilters(
  order: BinanceSpotFilterOrder,
  filters: readonly unknown[],
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
    );
  }

  let quantity: string;
  let price: string | null = null;
  let stopPrice: string | null = null;
  let marketReferencePrice: string | null = null;
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
    if (
      order.marketReferencePrice !== undefined &&
      order.marketReferencePrice !== null
    ) {
      marketReferencePrice = normalizeSpotDecimal(
        order.marketReferencePrice,
        'order.marketReferencePrice',
      );
      if (isZero(marketReferencePrice)) {
        throw new TypeError('marketReferencePrice must be positive');
      }
    }
  } catch {
    return freezeValidation(
      [failure('INVALID_ORDER', 'ORDER', 'decimal', null, null)],
      null,
    );
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
    if (step !== null && isZero(step)) {
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

  let needsMarketReference = false;
  const minNotional = supported.get('MIN_NOTIONAL');
  const notional = supported.get('NOTIONAL');

  if (minNotional !== undefined) {
    if (
      typeof minNotional.applyToMarket !== 'boolean' ||
      !Number.isSafeInteger(minNotional.avgPriceMins) ||
      (minNotional.avgPriceMins as number) < 0
    ) {
      failures.push(
        failure('MALFORMED_FILTER', 'MIN_NOTIONAL', 'marketApplication', null, null),
      );
    }
    needsMarketReference ||= order.type === 'MARKET' && minNotional.applyToMarket === true;
  }
  if (notional !== undefined) {
    if (
      typeof notional.applyMinToMarket !== 'boolean' ||
      typeof notional.applyMaxToMarket !== 'boolean' ||
      !Number.isSafeInteger(notional.avgPriceMins) ||
      (notional.avgPriceMins as number) < 0
    ) {
      failures.push(
        failure('MALFORMED_FILTER', 'NOTIONAL', 'marketApplication', null, null),
      );
    }
    needsMarketReference ||=
      order.type === 'MARKET' &&
      (notional.applyMinToMarket === true || notional.applyMaxToMarket === true);
  }

  const notionalPrice = order.type === 'LIMIT' ? price : marketReferencePrice;
  if (needsMarketReference && notionalPrice === null) {
    failures.push(
      failure(
        'MISSING_MARKET_REFERENCE_PRICE',
        'ORDER',
        'marketReferencePrice',
        null,
        null,
      ),
    );
  }
  const computedNotional =
    notionalPrice === null ? null : multiplySpotDecimals(quantity, notionalPrice);

  if (minNotional !== undefined) {
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
    if (
      applies &&
      min !== null &&
      computedNotional !== null &&
      compareSpotDecimals(computedNotional, min) < 0
    ) {
      failures.push(
        failure(
          'NOTIONAL_BELOW_MIN',
          'MIN_NOTIONAL',
          'notional',
          computedNotional,
          min,
        ),
      );
    }
  }

  if (notional !== undefined) {
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
    if (
      minApplies &&
      min !== null &&
      computedNotional !== null &&
      compareSpotDecimals(computedNotional, min) < 0
    ) {
      failures.push(
        failure(
          'NOTIONAL_BELOW_MIN',
          'NOTIONAL',
          'notional',
          computedNotional,
          min,
        ),
      );
    }
    if (
      maxApplies &&
      max !== null &&
      computedNotional !== null &&
      compareSpotDecimals(computedNotional, max) > 0
    ) {
      failures.push(
        failure(
          'NOTIONAL_ABOVE_MAX',
          'NOTIONAL',
          'notional',
          computedNotional,
          max,
        ),
      );
    }
  }

  return freezeValidation(failures, computedNotional);
}
