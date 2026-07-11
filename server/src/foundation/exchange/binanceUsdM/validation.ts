import {
  evaluateFreshness,
  isValidClientOrderId,
  isValidUtcMillis,
  validateSourcedTimestamp,
} from '../../contracts/index.js';
import {
  compareDecimalStrings,
  isDecimalOffsetMultiple,
  isPositiveDecimal,
  multiplyDecimalStrings,
  normalizeDecimalString,
} from './decimal.js';
import type { FormPair } from './signing.js';
import type {
  BinanceUsdMLotSizeFilter,
  BinanceUsdMPriceFilter,
  BinanceUsdMSymbolFilters,
  BinanceUsdMTestOrderInput,
} from './types.js';

export interface BinanceUsdMValidationIssue {
  readonly field: string;
  readonly code: string;
  readonly message: string;
  readonly category: 'INPUT' | 'FILTER';
}

export interface BinanceUsdMNormalizedTestOrder {
  readonly requestPairs: readonly FormPair[];
  readonly normalizedQuantity: string | null;
  readonly normalizedPrice: string | null;
  readonly normalizedReferencePrice: string | null;
}

export type BinanceUsdMTestOrderValidation =
  | { readonly ok: true; readonly value: BinanceUsdMNormalizedTestOrder; readonly issues: readonly [] }
  | { readonly ok: false; readonly issues: readonly BinanceUsdMValidationIssue[] };

const SYMBOL_PATTERN = /^[A-Z0-9._-]{1,40}$/;
const ORDER_TYPES = new Set([
  'LIMIT',
  'MARKET',
  'STOP',
  'STOP_MARKET',
  'TAKE_PROFIT',
  'TAKE_PROFIT_MARKET',
  'TRAILING_STOP_MARKET',
]);
const SIDES = new Set(['BUY', 'SELL']);
const POSITION_MODES = new Set(['ONE_WAY', 'HEDGE']);
const POSITION_SIDES = new Set(['BOTH', 'LONG', 'SHORT']);
const TIME_IN_FORCE = new Set(['GTC', 'IOC', 'FOK', 'GTX', 'GTD', 'RPI']);

function issue(
  issues: BinanceUsdMValidationIssue[],
  field: string,
  code: string,
  message: string,
  category: 'INPUT' | 'FILTER' = 'INPUT',
): void {
  issues.push(Object.freeze({ field, code, message, category }));
}

function normalizePositive(
  value: unknown,
  field: string,
  issues: BinanceUsdMValidationIssue[],
  required: boolean,
): string | null {
  if (value === undefined) {
    if (required) issue(issues, field, 'REQUIRED', `${field} is required`);
    return null;
  }
  try {
    const normalized = normalizeDecimalString(value);
    if (!isPositiveDecimal(normalized)) {
      issue(issues, field, 'POSITIVE_DECIMAL_REQUIRED', `${field} must be greater than zero`);
      return null;
    }
    return normalized;
  } catch {
    issue(issues, field, 'DECIMAL_STRING_INVALID', `${field} must be a bounded plain decimal string`);
    return null;
  }
}

function validatePriceFilter(
  value: string,
  filter: BinanceUsdMPriceFilter | null,
  field: string,
  issues: BinanceUsdMValidationIssue[],
): void {
  if (filter === null || typeof filter !== 'object') {
    issue(issues, 'exchangeSymbol.filters.price', 'FILTER_FACT_UNKNOWN', 'price filter facts are unavailable', 'FILTER');
    return;
  }
  let min: string;
  let max: string;
  let tick: string;
  try {
    min = normalizeDecimalString(filter.minPrice);
    max = normalizeDecimalString(filter.maxPrice);
    tick = normalizeDecimalString(filter.tickSize);
  } catch {
    issue(issues, 'exchangeSymbol.filters.price', 'FILTER_MALFORMED', 'price filter contains malformed decimals', 'FILTER');
    return;
  }
  if (
    compareDecimalStrings(min, '0') < 0 ||
    compareDecimalStrings(max, '0') < 0 ||
    compareDecimalStrings(tick, '0') < 0 ||
    (compareDecimalStrings(max, '0') > 0 && compareDecimalStrings(min, max) > 0)
  ) {
    issue(issues, 'exchangeSymbol.filters.price', 'FILTER_MALFORMED', 'price filter has a negative or incoherent domain', 'FILTER');
    return;
  }
  if (compareDecimalStrings(min, '0') > 0 && compareDecimalStrings(value, min) < 0) {
    issue(issues, field, 'PRICE_BELOW_MIN', `${field} is below PRICE_FILTER.minPrice`, 'FILTER');
  }
  if (compareDecimalStrings(max, '0') > 0 && compareDecimalStrings(value, max) > 0) {
    issue(issues, field, 'PRICE_ABOVE_MAX', `${field} is above PRICE_FILTER.maxPrice`, 'FILTER');
  }
  if (compareDecimalStrings(tick, '0') > 0 && !isDecimalOffsetMultiple(value, min, tick)) {
    issue(issues, field, 'PRICE_TICK_MISMATCH', `${field} is not aligned to PRICE_FILTER.minPrice + n*tickSize`, 'FILTER');
  }
}

function validateLotFilter(
  quantity: string,
  filter: BinanceUsdMLotSizeFilter | null,
  field: string,
  issues: BinanceUsdMValidationIssue[],
): void {
  if (filter === null || typeof filter !== 'object') {
    issue(issues, 'exchangeSymbol.filters.lotSize', 'FILTER_FACT_UNKNOWN', 'quantity filter facts are unavailable', 'FILTER');
    return;
  }
  let min: string;
  let max: string;
  let step: string;
  try {
    min = normalizeDecimalString(filter.minQty);
    max = normalizeDecimalString(filter.maxQty);
    step = normalizeDecimalString(filter.stepSize);
  } catch {
    issue(issues, 'exchangeSymbol.filters.lotSize', 'FILTER_MALFORMED', 'quantity filter contains malformed decimals', 'FILTER');
    return;
  }
  if (
    compareDecimalStrings(min, '0') <= 0 ||
    compareDecimalStrings(max, '0') <= 0 ||
    compareDecimalStrings(step, '0') <= 0 ||
    compareDecimalStrings(min, max) > 0
  ) {
    issue(issues, 'exchangeSymbol.filters.lotSize', 'FILTER_MALFORMED', 'quantity filter has a non-positive or incoherent domain', 'FILTER');
    return;
  }
  if (compareDecimalStrings(min, '0') > 0 && compareDecimalStrings(quantity, min) < 0) {
    issue(issues, field, 'QUANTITY_BELOW_MIN', `${field} is below the minimum quantity`, 'FILTER');
  }
  if (compareDecimalStrings(max, '0') > 0 && compareDecimalStrings(quantity, max) > 0) {
    issue(issues, field, 'QUANTITY_ABOVE_MAX', `${field} is above the maximum quantity`, 'FILTER');
  }
  if (compareDecimalStrings(step, '0') > 0 && !isDecimalOffsetMultiple(quantity, min, step)) {
    issue(issues, field, 'QUANTITY_STEP_MISMATCH', `${field} is not aligned to minQty + n*stepSize`, 'FILTER');
  }
}

function validateMinNotional(
  quantity: string | null,
  price: string | null,
  referencePrice: string | null,
  minNotionalValue: unknown,
  issues: BinanceUsdMValidationIssue[],
): void {
  if (quantity === null) return;
  if (minNotionalValue === null) {
    issue(issues, 'exchangeSymbol.filters.minNotional', 'FILTER_FACT_UNKNOWN', 'minimum-notional filter fact is unavailable', 'FILTER');
    return;
  }
  let minimum: string;
  try {
    minimum = normalizeDecimalString(minNotionalValue);
  } catch {
    issue(issues, 'exchangeSymbol.filters.minNotional', 'FILTER_MALFORMED', 'minimum-notional filter is malformed', 'FILTER');
    return;
  }
  if (compareDecimalStrings(minimum, '0') < 0) {
    issue(issues, 'exchangeSymbol.filters.minNotional', 'FILTER_MALFORMED', 'minimum-notional filter cannot be negative', 'FILTER');
    return;
  }
  if (compareDecimalStrings(minimum, '0') <= 0) return;
  const valuationPrice = price ?? referencePrice;
  if (valuationPrice === null) {
    issue(
      issues,
      'notionalReferencePrice',
      'FILTER_CONTEXT_UNKNOWN',
      'a reference price is required for exact MIN_NOTIONAL validation',
      'FILTER',
    );
    return;
  }
  try {
    const notional = multiplyDecimalStrings(quantity, valuationPrice);
    if (compareDecimalStrings(notional, minimum) < 0) {
      issue(issues, 'quantity', 'NOTIONAL_BELOW_MIN', 'quantity times valuation price is below MIN_NOTIONAL', 'FILTER');
    }
  } catch {
    issue(issues, 'quantity', 'FILTER_ARITHMETIC_BOUNDS', 'minimum-notional arithmetic exceeded bounded decimal limits', 'FILTER');
  }
}

function validatePercentPrice(
  price: string,
  referencePrice: string | null,
  filter: BinanceUsdMSymbolFilters['percentPrice'],
  issues: BinanceUsdMValidationIssue[],
): void {
  if (filter === null || typeof filter !== 'object') {
    issue(issues, 'exchangeSymbol.filters.percentPrice', 'FILTER_FACT_UNKNOWN', 'PERCENT_PRICE facts are unavailable', 'FILTER');
    return;
  }
  if (referencePrice === null) {
    issue(issues, 'notionalReferencePrice', 'FILTER_CONTEXT_UNKNOWN', 'a current reference price is required for PERCENT_PRICE', 'FILTER');
    return;
  }
  let up: string;
  let down: string;
  try {
    up = normalizeDecimalString(filter.multiplierUp);
    down = normalizeDecimalString(filter.multiplierDown);
  } catch {
    issue(issues, 'exchangeSymbol.filters.percentPrice', 'FILTER_MALFORMED', 'PERCENT_PRICE multipliers are malformed', 'FILTER');
    return;
  }
  if (
    compareDecimalStrings(up, '0') <= 0 ||
    compareDecimalStrings(down, '0') <= 0 ||
    compareDecimalStrings(down, up) > 0
  ) {
    issue(issues, 'exchangeSymbol.filters.percentPrice', 'FILTER_MALFORMED', 'PERCENT_PRICE multipliers are non-positive or incoherent', 'FILTER');
    return;
  }
  try {
    const lower = multiplyDecimalStrings(referencePrice, down);
    const upper = multiplyDecimalStrings(referencePrice, up);
    if (compareDecimalStrings(price, lower) < 0) {
      issue(issues, 'price', 'PRICE_BELOW_PERCENT_LIMIT', 'price is below referencePrice*multiplierDown', 'FILTER');
    }
    if (compareDecimalStrings(price, upper) > 0) {
      issue(issues, 'price', 'PRICE_ABOVE_PERCENT_LIMIT', 'price is above referencePrice*multiplierUp', 'FILTER');
    }
  } catch {
    issue(issues, 'price', 'FILTER_ARITHMETIC_BOUNDS', 'PERCENT_PRICE arithmetic exceeded bounded decimal limits', 'FILTER');
  }
}

function ensureAbsent(
  value: unknown,
  field: string,
  code: string,
  message: string,
  issues: BinanceUsdMValidationIssue[],
): void {
  if (value !== undefined) issue(issues, field, code, message);
}

export function validateTestOrder(
  input: unknown,
  nowMs: number,
): BinanceUsdMTestOrderValidation {
  const issues: BinanceUsdMValidationIssue[] = [];
  if (!isValidUtcMillis(nowMs)) {
    throw new TypeError('validateTestOrder: nowMs must be injected valid UTC milliseconds');
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze([
        Object.freeze({ field: '', code: 'OBJECT_REQUIRED', message: 'test order must be an object', category: 'INPUT' as const }),
      ]),
    });
  }
  const value = input as Record<string, unknown> & Partial<BinanceUsdMTestOrderInput>;
  if (typeof value.symbol !== 'string' || !SYMBOL_PATTERN.test(value.symbol)) {
    issue(issues, 'symbol', 'SYMBOL_INVALID', 'symbol must be an uppercase bounded venue symbol');
  }
  if (!SIDES.has(String(value.side))) issue(issues, 'side', 'SIDE_INVALID', 'side must be BUY or SELL');
  if (!ORDER_TYPES.has(String(value.type))) issue(issues, 'type', 'ORDER_TYPE_INVALID', 'order type is unsupported');
  if (!POSITION_MODES.has(String(value.positionMode))) {
    issue(issues, 'positionMode', 'POSITION_MODE_INVALID', 'positionMode must be explicit ONE_WAY or HEDGE');
  }
  if (!POSITION_SIDES.has(String(value.positionSide))) {
    issue(issues, 'positionSide', 'POSITION_SIDE_INVALID', 'positionSide must be BOTH, LONG, or SHORT');
  }
  if (value.timeInForce !== undefined && !TIME_IN_FORCE.has(String(value.timeInForce))) {
    issue(issues, 'timeInForce', 'TIME_IN_FORCE_INVALID', 'timeInForce is not supported by USD-M test order');
  }
  if (value.reduceOnly !== undefined && typeof value.reduceOnly !== 'boolean') {
    issue(issues, 'reduceOnly', 'BOOLEAN_REQUIRED', 'reduceOnly must be boolean when sent');
  }
  if (value.closePosition !== undefined && typeof value.closePosition !== 'boolean') {
    issue(issues, 'closePosition', 'BOOLEAN_REQUIRED', 'closePosition must be boolean when sent');
  }
  if (value.newClientOrderId !== undefined && !isValidClientOrderId(value.newClientOrderId)) {
    issue(issues, 'newClientOrderId', 'CLIENT_ORDER_ID_INVALID', 'newClientOrderId violates the frozen conservative venue constraint');
  }

  if (value.positionMode === 'ONE_WAY' && value.positionSide !== 'BOTH') {
    issue(issues, 'positionSide', 'ONE_WAY_REQUIRES_BOTH', 'ONE_WAY mode requires positionSide BOTH');
  }
  if (value.positionMode === 'HEDGE') {
    if (value.positionSide !== 'LONG' && value.positionSide !== 'SHORT') {
      issue(issues, 'positionSide', 'HEDGE_REQUIRES_DIRECTION', 'HEDGE mode requires LONG or SHORT positionSide');
    }
    if (value.reduceOnly !== undefined) {
      issue(issues, 'reduceOnly', 'REDUCE_ONLY_FORBIDDEN_IN_HEDGE', 'reduceOnly cannot be sent in HEDGE mode');
    }
  }
  if (value.closePosition === true && value.reduceOnly !== undefined) {
    issue(issues, 'reduceOnly', 'REDUCE_ONLY_WITH_CLOSE_POSITION', 'reduceOnly cannot be sent with closePosition=true');
  }
  if (
    value.positionMode === 'HEDGE' &&
    value.closePosition === true &&
    ((value.side === 'BUY' && value.positionSide === 'LONG') ||
      (value.side === 'SELL' && value.positionSide === 'SHORT'))
  ) {
    issue(issues, 'closePosition', 'HEDGE_CLOSE_SIDE_INVALID', 'close-all cannot increase the selected HEDGE side');
  }

  const type = String(value.type);
  const closeAll = value.closePosition === true;
  const needsQuantity = !closeAll && ORDER_TYPES.has(type);
  const quantity = normalizePositive(value.quantity, 'quantity', issues, needsQuantity);
  const needsPrice = type === 'LIMIT' || type === 'STOP' || type === 'TAKE_PROFIT';
  const price = normalizePositive(value.price, 'price', issues, needsPrice);
  const needsStop = type === 'STOP' || type === 'STOP_MARKET' || type === 'TAKE_PROFIT' || type === 'TAKE_PROFIT_MARKET';
  const stopPrice = normalizePositive(value.stopPrice, 'stopPrice', issues, needsStop);
  const activationPrice = normalizePositive(value.activationPrice, 'activationPrice', issues, false);
  const callbackRate = normalizePositive(value.callbackRate, 'callbackRate', issues, type === 'TRAILING_STOP_MARKET');
  const referencePrice = normalizePositive(value.notionalReferencePrice, 'notionalReferencePrice', issues, false);

  if (closeAll && value.quantity !== undefined) {
    issue(issues, 'quantity', 'QUANTITY_WITH_CLOSE_POSITION', 'quantity cannot be sent with closePosition=true');
  }
  if (closeAll && type !== 'STOP_MARKET' && type !== 'TAKE_PROFIT_MARKET') {
    issue(issues, 'closePosition', 'CLOSE_POSITION_TYPE_INVALID', 'closePosition is supported only for STOP_MARKET and TAKE_PROFIT_MARKET');
  }

  const timeInForceAllowed = type === 'LIMIT' || type === 'STOP' || type === 'TAKE_PROFIT';
  if (type === 'LIMIT' && value.timeInForce === undefined) {
    issue(issues, 'timeInForce', 'TIME_IN_FORCE_REQUIRED', 'timeInForce is required for LIMIT');
  }
  if (!timeInForceAllowed) {
    ensureAbsent(value.timeInForce, 'timeInForce', 'TIME_IN_FORCE_FORBIDDEN', 'timeInForce is not valid for this order type', issues);
  }
  if (!needsPrice) ensureAbsent(value.price, 'price', 'PRICE_FORBIDDEN', 'price is not valid for this order type', issues);
  if (!needsStop) ensureAbsent(value.stopPrice, 'stopPrice', 'STOP_PRICE_FORBIDDEN', 'stopPrice is not valid for this order type', issues);
  if (type !== 'TRAILING_STOP_MARKET') {
    ensureAbsent(value.activationPrice, 'activationPrice', 'ACTIVATION_PRICE_FORBIDDEN', 'activationPrice requires TRAILING_STOP_MARKET', issues);
    ensureAbsent(value.callbackRate, 'callbackRate', 'CALLBACK_RATE_FORBIDDEN', 'callbackRate requires TRAILING_STOP_MARKET', issues);
  }
  if (callbackRate !== null && (compareDecimalStrings(callbackRate, '0.1') < 0 || compareDecimalStrings(callbackRate, '5') > 0)) {
    issue(issues, 'callbackRate', 'CALLBACK_RATE_RANGE', 'callbackRate must be in the inclusive range 0.1..5');
  }

  let effectiveGoodTillDateMs: number | null = null;
  if (value.timeInForce === 'GTD') {
    if (!Number.isSafeInteger(value.goodTillDateMs)) {
      issue(issues, 'goodTillDateMs', 'GOOD_TILL_DATE_REQUIRED', 'GTD requires a safe-integer goodTillDateMs');
    } else {
      effectiveGoodTillDateMs = Math.floor((value.goodTillDateMs as number) / 1_000) * 1_000;
    }
    if (
      effectiveGoodTillDateMs !== null &&
      (effectiveGoodTillDateMs <= nowMs + 600_000 || effectiveGoodTillDateMs >= 253_402_300_799_000)
    ) {
      issue(issues, 'goodTillDateMs', 'GOOD_TILL_DATE_RANGE', 'goodTillDateMs must be more than 600 seconds ahead and below the venue maximum');
    }
  } else if (value.goodTillDateMs !== undefined) {
    issue(issues, 'goodTillDateMs', 'GOOD_TILL_DATE_WITHOUT_GTD', 'goodTillDateMs can be sent only with GTD');
  }

  const exchangeSymbol = value.exchangeSymbol;
  let typedFilters: BinanceUsdMSymbolFilters | null = null;
  if (typeof exchangeSymbol !== 'object' || exchangeSymbol === null || Array.isArray(exchangeSymbol)) {
    issue(issues, 'exchangeSymbol', 'FILTER_FACT_UNKNOWN', 'exchangeInfo-derived symbol facts are required', 'FILTER');
  } else {
    const timestampIssues = validateSourcedTimestamp(exchangeSymbol.observedAt);
    if (timestampIssues.length > 0) {
      issue(issues, 'exchangeSymbol.observedAt', 'FILTER_PROVENANCE_MALFORMED', 'exchangeInfo observation provenance is malformed', 'FILTER');
    } else if (
      exchangeSymbol.observedAt.authority === 'UNAVAILABLE' ||
      exchangeSymbol.observedAt.completeness === 'UNAVAILABLE'
    ) {
      issue(issues, 'exchangeSymbol.observedAt', 'FILTER_FACT_UNAVAILABLE', 'exchangeInfo filter facts are unavailable', 'FILTER');
    } else if (exchangeSymbol.observedAt.completeness !== 'COMPLETE') {
      issue(issues, 'exchangeSymbol.observedAt', 'FILTER_FACT_PARTIAL', 'exchangeInfo filter facts are partial', 'FILTER');
    } else {
      const freshness = evaluateFreshness(exchangeSymbol.observedAt, nowMs);
      if (freshness.state === 'STALE') {
        issue(issues, 'exchangeSymbol.observedAt', 'FILTER_FACT_STALE', 'exchangeInfo filter facts are stale', 'FILTER');
      } else if (freshness.state === 'CLOCK_SKEWED') {
        issue(issues, 'exchangeSymbol.observedAt', 'FILTER_FACT_CLOCK_SKEWED', 'exchangeInfo filter facts are future-skewed', 'FILTER');
      } else if (freshness.state !== 'FRESH') {
        issue(issues, 'exchangeSymbol.observedAt', 'FILTER_FACT_UNAVAILABLE', 'exchangeInfo filter freshness is unavailable', 'FILTER');
      }
    }
    if (typeof exchangeSymbol.symbol !== 'string' || exchangeSymbol.symbol !== value.symbol) {
      issue(issues, 'exchangeSymbol.symbol', 'FILTER_SYMBOL_MISMATCH', 'exchangeInfo symbol facts do not match the order symbol', 'FILTER');
    }
    if (exchangeSymbol.status !== 'TRADING') {
      issue(issues, 'exchangeSymbol.status', 'SYMBOL_NOT_TRADING', 'exchangeInfo does not report the symbol as TRADING', 'FILTER');
    }
    if (!Array.isArray(exchangeSymbol.orderTypes) || !exchangeSymbol.orderTypes.every((item) => typeof item === 'string')) {
      issue(issues, 'exchangeSymbol.orderTypes', 'FILTER_MALFORMED', 'order-type capabilities are malformed', 'FILTER');
    } else if (!exchangeSymbol.orderTypes.includes(type)) {
      issue(issues, 'type', 'ORDER_TYPE_UNSUPPORTED_BY_SYMBOL', 'exchangeInfo does not advertise this order type', 'FILTER');
    }
    if (!Array.isArray(exchangeSymbol.timeInForce) || !exchangeSymbol.timeInForce.every((item) => typeof item === 'string')) {
      issue(issues, 'exchangeSymbol.timeInForce', 'FILTER_MALFORMED', 'time-in-force capabilities are malformed', 'FILTER');
    } else if (value.timeInForce !== undefined && !exchangeSymbol.timeInForce.includes(value.timeInForce)) {
      issue(issues, 'timeInForce', 'TIME_IN_FORCE_UNSUPPORTED_BY_SYMBOL', 'exchangeInfo does not advertise this timeInForce', 'FILTER');
    }
    if (typeof exchangeSymbol.filters !== 'object' || exchangeSymbol.filters === null || Array.isArray(exchangeSymbol.filters)) {
      issue(issues, 'exchangeSymbol.filters', 'FILTER_FACT_UNKNOWN', 'exchangeInfo-derived filters are required', 'FILTER');
    } else {
      typedFilters = exchangeSymbol.filters as BinanceUsdMSymbolFilters;
    }
  }
  if (typedFilters !== null) {
    if (quantity !== null) {
      const marketExecution = type === 'MARKET' || type === 'STOP_MARKET' || type === 'TAKE_PROFIT_MARKET' || type === 'TRAILING_STOP_MARKET';
      const lot = marketExecution ? typedFilters.marketLotSize : typedFilters.lotSize;
      validateLotFilter(quantity, lot, 'quantity', issues);
    }
    if (price !== null) {
      validatePriceFilter(price, typedFilters.price, 'price', issues);
      validatePercentPrice(price, referencePrice, typedFilters.percentPrice, issues);
    }
    if (stopPrice !== null) validatePriceFilter(stopPrice, typedFilters.price, 'stopPrice', issues);
    if (activationPrice !== null) validatePriceFilter(activationPrice, typedFilters.price, 'activationPrice', issues);
    validateMinNotional(quantity, price, referencePrice, typedFilters.minNotional, issues);
  }

  if (issues.length > 0) {
    return Object.freeze({ ok: false as const, issues: Object.freeze([...issues]) });
  }

  const pairs: FormPair[] = [
    ['symbol', value.symbol as string],
    ['side', value.side as string],
    ['type', value.type as string],
    ['positionSide', value.positionSide as string],
  ];
  if (quantity !== null) pairs.push(['quantity', quantity]);
  if (price !== null) pairs.push(['price', price]);
  if (stopPrice !== null) pairs.push(['stopPrice', stopPrice]);
  if (activationPrice !== null) pairs.push(['activationPrice', activationPrice]);
  if (callbackRate !== null) pairs.push(['callbackRate', callbackRate]);
  if (value.timeInForce !== undefined) pairs.push(['timeInForce', value.timeInForce]);
  if (value.reduceOnly !== undefined) pairs.push(['reduceOnly', value.reduceOnly]);
  if (value.closePosition !== undefined) pairs.push(['closePosition', value.closePosition]);
  if (effectiveGoodTillDateMs !== null) pairs.push(['goodTillDate', effectiveGoodTillDateMs]);
  if (value.newClientOrderId !== undefined) pairs.push(['newClientOrderId', value.newClientOrderId]);

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      requestPairs: Object.freeze(pairs),
      normalizedQuantity: quantity,
      normalizedPrice: price,
      normalizedReferencePrice: referencePrice,
    }),
    issues: Object.freeze([]) as readonly [],
  });
}
