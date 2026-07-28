import {
  evaluateFreshness,
  isValidClientOrderId,
  isValidUtcMillis,
  type SourcedTimestamp,
  validateSourcedTimestamp,
} from '../../contracts/index.js';
import {
  compareDecimalStrings,
  isDecimalOffsetMultiple,
  isPositiveDecimal,
  multiplyDecimalStrings,
  normalizeDecimalString,
} from './decimal.js';
import type {
  BinanceUsdMLotSizeFilter,
  BinanceUsdMExchangeSymbol,
  BinanceUsdMFundingRate,
  BinanceUsdMMarkFunding,
  BinanceUsdMPriceFilter,
  BinanceUsdMSymbolFilters,
  BinanceUsdMTestOrderInput,
} from './types.js';

type FormPair = readonly [
  name: string,
  value: string | number | boolean,
];

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
  filterField = 'exchangeSymbol.filters.lotSize',
): void {
  if (filter === null || typeof filter !== 'object') {
    issue(issues, filterField, 'FILTER_FACT_UNKNOWN', 'quantity filter facts are unavailable', 'FILTER');
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
    issue(issues, filterField, 'FILTER_MALFORMED', 'quantity filter contains malformed decimals', 'FILTER');
    return;
  }
  if (
    compareDecimalStrings(min, '0') <= 0 ||
    compareDecimalStrings(max, '0') <= 0 ||
    compareDecimalStrings(step, '0') <= 0 ||
    compareDecimalStrings(min, max) > 0
  ) {
    issue(issues, filterField, 'FILTER_MALFORMED', 'quantity filter has a non-positive or incoherent domain', 'FILTER');
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
  side: unknown,
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
    if (side === 'BUY') {
      const upper = multiplyDecimalStrings(referencePrice, up);
      if (compareDecimalStrings(price, upper) > 0) {
        issue(issues, 'price', 'PRICE_ABOVE_PERCENT_LIMIT', 'BUY price is above referencePrice*multiplierUp', 'FILTER');
      }
    } else if (side === 'SELL') {
      const lower = multiplyDecimalStrings(referencePrice, down);
      if (compareDecimalStrings(price, lower) < 0) {
        issue(issues, 'price', 'PRICE_BELOW_PERCENT_LIMIT', 'SELL price is below referencePrice*multiplierDown', 'FILTER');
      }
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
    const unsupportedFilterTypes =
      (typedFilters as BinanceUsdMSymbolFilters).unsupportedFilterTypes;
    if (
      !Array.isArray(unsupportedFilterTypes) ||
      unsupportedFilterTypes.length > 32 ||
      !unsupportedFilterTypes.every(
        (filterType) =>
          typeof filterType === 'string' &&
          /^[A-Z0-9_]{1,64}$/.test(filterType),
      ) ||
      new Set(unsupportedFilterTypes).size !==
        unsupportedFilterTypes.length
    ) {
      issue(
        issues,
        'exchangeSymbol.filters.unsupportedFilterTypes',
        'FILTER_MALFORMED',
        'unsupported filter-type evidence is malformed',
        'FILTER',
      );
    } else if (unsupportedFilterTypes.length > 0) {
      issue(
        issues,
        'exchangeSymbol.filters.unsupportedFilterTypes',
        'UNSUPPORTED_FILTER_TYPE',
        'venue advertises a filter family this validator cannot enforce',
        'FILTER',
      );
    }
    const maxNumOrders = typedFilters.maxNumOrders;
    if (
      maxNumOrders !== null &&
      (!Number.isSafeInteger(maxNumOrders) || maxNumOrders <= 0)
    ) {
      issue(
        issues,
        'exchangeSymbol.filters.maxNumOrders',
        'FILTER_MALFORMED',
        'MAX_NUM_ORDERS must be null or a positive safe integer',
        'FILTER',
      );
    } else if (maxNumOrders !== null) {
      issue(
        issues,
        'exchangeSymbol.filters.maxNumOrders',
        'MAX_NUM_ORDERS_CONTEXT_UNKNOWN',
        'MAX_NUM_ORDERS cannot be evaluated without current private open-order truth',
        'FILTER',
      );
    }
    if (quantity !== null) {
      const marketExecution = type === 'MARKET' || type === 'STOP_MARKET' || type === 'TAKE_PROFIT_MARKET' || type === 'TRAILING_STOP_MARKET';
      validateLotFilter(quantity, typedFilters.lotSize, 'quantity', issues);
      if (marketExecution) {
        validateLotFilter(
          quantity,
          typedFilters.marketLotSize,
          'quantity',
          issues,
          'exchangeSymbol.filters.marketLotSize',
        );
      }
    }
    if (price !== null) {
      validatePriceFilter(price, typedFilters.price, 'price', issues);
      validatePercentPrice(price, referencePrice, typedFilters.percentPrice, value.side, issues);
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

export const BINANCE_USDM_PUBLIC_GROUNDWORK_SCHEMA =
  'cosmos.foundation.binance-usdm-public-groundwork.v1' as const;
export const MAX_BINANCE_USDM_PUBLIC_EVIDENCE_AGE_MS = 300_000 as const;

export const BINANCE_USDM_PUBLIC_GROUNDWORK_CAPABILITIES = Object.freeze({
  localValidation: true,
  publicEvidenceProjection: true,
  networkAccess: false,
  privateRead: false,
  signedRequest: false,
  testOrder: false,
  liveOrder: false,
  cancelOrder: false,
  borrow: false,
  repay: false,
  transfer: false,
  withdrawal: false,
} as const);

const NO_PUBLIC_GROUNDWORK_EXTERNAL_ACTIONS =
  Object.freeze([]) as readonly never[];
const PUBLIC_GROUNDWORK_AUTHORITIES = new Set([
  'LIVE_PUBLIC',
  'RECORDED_REPLAY',
  'SYNTHETIC_TEST',
]);

export const BINANCE_USDM_PUBLIC_GROUNDWORK_BLOCKING_CODES = Object.freeze([
  'CONFIG_INVALID',
  'SOURCE_DISABLED',
  'INPUT_INVALID',
  'EVALUATION_TIME_INVALID',
  'KILL_SWITCH_ENGAGED_OR_UNKNOWN',
  'SYMBOL_INVALID',
  'SYMBOL_NOT_ALLOWLISTED',
  'EXCHANGE_SYMBOL_INVALID',
  'EXCHANGE_SYMBOL_MISMATCH',
  'EXCHANGE_SYMBOL_STALE',
  'SYMBOL_NOT_TRADING',
  'SYMBOL_MARKET_ORDER_UNSUPPORTED',
  'FILTER_EVIDENCE_INVALID',
  'FILTER_TYPE_UNSUPPORTED',
  'FUNDING_FORECAST_INVALID',
  'FUNDING_FORECAST_SYMBOL_MISMATCH',
  'FUNDING_FORECAST_STALE',
  'FUNDING_HISTORY_INVALID',
  'FUNDING_HISTORY_SYMBOL_MISMATCH',
  'FUNDING_HISTORY_STALE',
  'FUNDING_HISTORY_DUPLICATE',
  'FUNDING_HISTORY_CONFLICT',
] as const);

export type BinanceUsdMPublicGroundworkBlockingCode =
  (typeof BINANCE_USDM_PUBLIC_GROUNDWORK_BLOCKING_CODES)[number];

export interface BinanceUsdMPublicGroundworkSeamConfig {
  /** Exact true is required to expose even local public-data validation. */
  readonly sourceEnabled: boolean;
  /** Empty by default. No symbol is inferred or selected by this seam. */
  readonly allowedSymbols: readonly string[];
  readonly maximumFilterAgeMs: number;
  readonly maximumForecastAgeMs: number;
  readonly maximumHistoryCaptureAgeMs: number;
}

export const DEFAULT_BINANCE_USDM_PUBLIC_GROUNDWORK_CONFIG:
  Readonly<BinanceUsdMPublicGroundworkSeamConfig> = Object.freeze({
    sourceEnabled: false,
    allowedSymbols: Object.freeze([]),
    maximumFilterAgeMs: 60_000,
    maximumForecastAgeMs: 15_000,
    maximumHistoryCaptureAgeMs: 60_000,
  });

export interface BinanceUsdMPublicFundingForecastEvidence {
  readonly revision: string;
  readonly observedAt: Readonly<SourcedTimestamp>;
  readonly value: Readonly<BinanceUsdMMarkFunding>;
}

export interface BinanceUsdMPublicFundingHistoryEvidence {
  readonly revision: string;
  /**
   * Capture provenance. The history endpoint publishes event time per row,
   * not one response-level source time, so sourceTimeMs must be null.
   */
  readonly observedAt: Readonly<SourcedTimestamp>;
  readonly rows: readonly Readonly<BinanceUsdMFundingRate>[];
}

export interface BinanceUsdMPublicGroundworkInput {
  /** Injected evaluation time. This module never reads a clock. */
  readonly nowMs: number;
  /**
   * Current combined control posture. It is deliberately per invocation:
   * exact false is the sole clear state; true, null, missing, or malformed
   * values remain closed.
   */
  readonly currentEffectiveKillSwitchEngaged: boolean | null;
  readonly symbol: string;
  readonly exchangeSymbol: Readonly<BinanceUsdMExchangeSymbol>;
  readonly fundingForecast: Readonly<BinanceUsdMPublicFundingForecastEvidence>;
  readonly fundingHistory: Readonly<BinanceUsdMPublicFundingHistoryEvidence>;
}

export interface BinanceUsdMValidatedPublicFilters {
  readonly observedAt: Readonly<SourcedTimestamp>;
  readonly price: Readonly<BinanceUsdMPriceFilter>;
  readonly lotSize: Readonly<BinanceUsdMLotSizeFilter>;
  readonly marketLotSize: Readonly<BinanceUsdMLotSizeFilter>;
  readonly minNotional: string;
  readonly percentPrice: Readonly<{
    readonly multiplierUp: string;
    readonly multiplierDown: string;
    readonly multiplierDecimal: number;
  }>;
  /** Public limit fact only; no private open-order count is read or inferred. */
  readonly maxNumOrders: number | null;
  readonly maxNumOrdersEvaluation:
    'NOT_EVALUATED_PRIVATE_OPEN_ORDER_TRUTH_UNAVAILABLE';
  readonly unsupportedFilterTypes: readonly string[];
}

export interface BinanceUsdMFundingForecastProjection {
  readonly kind: 'FORECAST_ONLY';
  readonly evidenceRevision: string;
  readonly observedAt: Readonly<SourcedTimestamp>;
  readonly value: Readonly<BinanceUsdMMarkFunding>;
  readonly capturedAsSettlement: false;
}

export interface BinanceUsdMFundingHistoryProjectionRow {
  readonly symbol: string;
  readonly fundingRate: string;
  readonly fundingTimeMs: number;
  readonly markPrice: string | null;
  readonly rateType: 'Regular' | 'Special';
}

export interface BinanceUsdMFundingHistoryProjection {
  readonly kind: 'PUBLIC_SETTLEMENT_RATE_HISTORY';
  readonly evidenceRevision: string;
  readonly observedAt: Readonly<SourcedTimestamp>;
  readonly symbol: string;
  readonly rows: readonly Readonly<BinanceUsdMFundingHistoryProjectionRow>[];
  readonly capturesPublicSettlementRate: true;
  readonly capturesAccountPayment: false;
}

export interface BinanceUsdMPublicGroundworkResult {
  readonly schema: typeof BINANCE_USDM_PUBLIC_GROUNDWORK_SCHEMA;
  readonly version: 1;
  readonly mode: 'VALIDATE_ONLY';
  readonly validationPassed: boolean;
  readonly evaluatedAtMs: number | null;
  readonly symbol: string | null;
  readonly filters: Readonly<BinanceUsdMValidatedPublicFilters> | null;
  readonly fundingForecast:
    | Readonly<BinanceUsdMFundingForecastProjection>
    | null;
  readonly fundingHistory:
    | Readonly<BinanceUsdMFundingHistoryProjection>
    | null;
  readonly blockingCodes:
    readonly BinanceUsdMPublicGroundworkBlockingCode[];
  readonly authority: 'NONE';
  readonly externalActionAuthorization: 'NONE';
  readonly permittedExternalActions: readonly never[];
  readonly networkRequestsPerformed: 0;
  readonly privateRequestsPerformed: 0;
  readonly signedRequestsPerformed: 0;
  readonly ordersPerformed: 0;
  readonly sideEffectsPerformed: 0;
  readonly capabilities: typeof BINANCE_USDM_PUBLIC_GROUNDWORK_CAPABILITIES;
}

export interface BinanceUsdMPublicGroundworkSeam {
  readonly mode: 'VALIDATE_ONLY';
  readonly sourceEnabled: boolean;
  readonly validate: (
    input: Readonly<BinanceUsdMPublicGroundworkInput>,
  ) => Readonly<BinanceUsdMPublicGroundworkResult>;
}

type PublicGroundworkRecord = Record<string, unknown>;

function publicGroundworkRecord(value: unknown): PublicGroundworkRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as PublicGroundworkRecord)
    : null;
}

function validPublicGroundworkRevision(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value
  );
}

function validPublicGroundworkSymbol(value: unknown): value is string {
  return typeof value === 'string' && SYMBOL_PATTERN.test(value);
}

function validPublicGroundworkAge(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_BINANCE_USDM_PUBLIC_EVIDENCE_AGE_MS
  );
}

function validPublicGroundworkConfig(
  value: Readonly<BinanceUsdMPublicGroundworkSeamConfig>,
): boolean {
  return (
    typeof value?.sourceEnabled === 'boolean' &&
    Array.isArray(value.allowedSymbols) &&
    value.allowedSymbols.length <= 500 &&
    value.allowedSymbols.every(validPublicGroundworkSymbol) &&
    new Set(value.allowedSymbols).size === value.allowedSymbols.length &&
    validPublicGroundworkAge(value.maximumFilterAgeMs) &&
    validPublicGroundworkAge(value.maximumForecastAgeMs) &&
    validPublicGroundworkAge(value.maximumHistoryCaptureAgeMs)
  );
}

function copyPublicGroundworkTimestamp(
  value: Readonly<SourcedTimestamp>,
): Readonly<SourcedTimestamp> {
  return Object.freeze({
    sourceTimeMs: value.sourceTimeMs,
    receivedAtMs: value.receivedAtMs,
    maxAgeMs: value.maxAgeMs,
    authority: value.authority,
    completeness: value.completeness,
    sourceId: value.sourceId,
  });
}

function publicGroundworkTimestampFresh(
  value: unknown,
  nowMs: number,
  maximumAgeMs: number,
  sourceTimeRequirement: 'ANY' | 'REQUIRED' | 'ABSENT',
): value is Readonly<SourcedTimestamp> {
  if (validateSourcedTimestamp(value).length > 0) return false;
  const timestamp = value as SourcedTimestamp;
  if (
    timestamp.completeness !== 'COMPLETE' ||
    !PUBLIC_GROUNDWORK_AUTHORITIES.has(timestamp.authority) ||
    timestamp.maxAgeMs > maximumAgeMs ||
    timestamp.receivedAtMs > nowMs ||
    (timestamp.sourceTimeMs !== null && timestamp.sourceTimeMs > nowMs) ||
    (sourceTimeRequirement === 'REQUIRED' && timestamp.sourceTimeMs === null) ||
    (sourceTimeRequirement === 'ABSENT' && timestamp.sourceTimeMs !== null)
  ) {
    return false;
  }
  try {
    return evaluateFreshness(timestamp, nowMs).state === 'FRESH';
  } catch {
    return false;
  }
}

function publicGroundworkDecimal(
  value: unknown,
  rule: 'ANY' | 'NON_NEGATIVE' | 'POSITIVE',
): value is string {
  try {
    const normalized = normalizeDecimalString(value);
    const compared = compareDecimalStrings(normalized, '0');
    return (
      rule === 'ANY' ||
      (rule === 'NON_NEGATIVE' && compared >= 0) ||
      (rule === 'POSITIVE' && compared > 0)
    );
  } catch {
    return false;
  }
}

function copyPriceFilter(
  value: unknown,
): Readonly<BinanceUsdMPriceFilter> | null {
  const filter = publicGroundworkRecord(value);
  if (
    filter === null ||
    !publicGroundworkDecimal(filter.minPrice, 'NON_NEGATIVE') ||
    !publicGroundworkDecimal(filter.maxPrice, 'NON_NEGATIVE') ||
    !publicGroundworkDecimal(filter.tickSize, 'NON_NEGATIVE')
  ) {
    return null;
  }
  if (
    compareDecimalStrings(filter.maxPrice, '0') > 0 &&
    compareDecimalStrings(filter.minPrice, filter.maxPrice) > 0
  ) {
    return null;
  }
  return Object.freeze({
    minPrice: filter.minPrice,
    maxPrice: filter.maxPrice,
    tickSize: filter.tickSize,
  });
}

function copyLotFilter(
  value: unknown,
): Readonly<BinanceUsdMLotSizeFilter> | null {
  const filter = publicGroundworkRecord(value);
  if (
    filter === null ||
    !publicGroundworkDecimal(filter.minQty, 'POSITIVE') ||
    !publicGroundworkDecimal(filter.maxQty, 'POSITIVE') ||
    !publicGroundworkDecimal(filter.stepSize, 'POSITIVE') ||
    compareDecimalStrings(filter.minQty, filter.maxQty) > 0
  ) {
    return null;
  }
  return Object.freeze({
    minQty: filter.minQty,
    maxQty: filter.maxQty,
    stepSize: filter.stepSize,
  });
}

function copyPublicGroundworkFilters(
  value: unknown,
  observedAt: Readonly<SourcedTimestamp>,
  blockingCodes: BinanceUsdMPublicGroundworkBlockingCode[],
): Readonly<BinanceUsdMValidatedPublicFilters> | null {
  const filters = publicGroundworkRecord(value);
  if (filters === null) {
    blockingCodes.push('FILTER_EVIDENCE_INVALID');
    return null;
  }
  const price = copyPriceFilter(filters.price);
  const lotSize = copyLotFilter(filters.lotSize);
  const marketLotSize = copyLotFilter(filters.marketLotSize);
  const percent = publicGroundworkRecord(filters.percentPrice);
  const unsupported = filters.unsupportedFilterTypes;
  const maxNumOrders = filters.maxNumOrders;
  const maxNumOrdersValid =
    maxNumOrders === null ||
    (typeof maxNumOrders === 'number' &&
      Number.isSafeInteger(maxNumOrders) &&
      maxNumOrders > 0);
  const unsupportedValid =
    Array.isArray(unsupported) &&
    unsupported.length <= 32 &&
    unsupported.every(
      (item) =>
        typeof item === 'string' &&
        /^[A-Z0-9_]{1,64}$/.test(item),
    ) &&
    new Set(unsupported).size === unsupported.length;
  const percentValid =
    percent !== null &&
    publicGroundworkDecimal(percent.multiplierUp, 'POSITIVE') &&
    publicGroundworkDecimal(percent.multiplierDown, 'POSITIVE') &&
    compareDecimalStrings(percent.multiplierDown, percent.multiplierUp) <= 0 &&
    typeof percent.multiplierDecimal === 'number' &&
    Number.isSafeInteger(percent.multiplierDecimal) &&
    percent.multiplierDecimal >= 0;
  if (
    price === null ||
    lotSize === null ||
    marketLotSize === null ||
    !publicGroundworkDecimal(filters.minNotional, 'POSITIVE') ||
    !percentValid ||
    !maxNumOrdersValid ||
    !unsupportedValid
  ) {
    blockingCodes.push('FILTER_EVIDENCE_INVALID');
    return null;
  }
  if (unsupported.length > 0) {
    blockingCodes.push('FILTER_TYPE_UNSUPPORTED');
  }
  return Object.freeze({
    observedAt: copyPublicGroundworkTimestamp(observedAt),
    price,
    lotSize,
    marketLotSize,
    minNotional: filters.minNotional,
    percentPrice: Object.freeze({
      multiplierUp: percent.multiplierUp as string,
      multiplierDown: percent.multiplierDown as string,
      multiplierDecimal: percent.multiplierDecimal as number,
    }),
    maxNumOrders: maxNumOrders as number | null,
    maxNumOrdersEvaluation:
      'NOT_EVALUATED_PRIVATE_OPEN_ORDER_TRUTH_UNAVAILABLE' as const,
    unsupportedFilterTypes: Object.freeze([...unsupported]),
  });
}

function copyFundingForecast(
  evidenceValue: unknown,
  symbol: string,
  nowMs: number,
  maximumAgeMs: number,
  blockingCodes: BinanceUsdMPublicGroundworkBlockingCode[],
): Readonly<BinanceUsdMFundingForecastProjection> | null {
  const evidence = publicGroundworkRecord(evidenceValue);
  const value = publicGroundworkRecord(evidence?.value);
  if (
    evidence === null ||
    value === null ||
    !validPublicGroundworkRevision(evidence.revision) ||
    !publicGroundworkTimestampFresh(
      evidence.observedAt,
      nowMs,
      maximumAgeMs,
      'REQUIRED',
    ) ||
    !validPublicGroundworkSymbol(value.symbol) ||
    !publicGroundworkDecimal(value.markPrice, 'POSITIVE') ||
    !publicGroundworkDecimal(value.indexPrice, 'POSITIVE') ||
    !publicGroundworkDecimal(value.estimatedSettlePrice, 'NON_NEGATIVE') ||
    !publicGroundworkDecimal(value.lastFundingRate, 'ANY') ||
    !publicGroundworkDecimal(value.interestRate, 'ANY') ||
    !isValidUtcMillis(value.nextFundingTimeMs) ||
    !isValidUtcMillis(value.sourceTimeMs) ||
    value.sourceTimeMs !==
      (evidence.observedAt as SourcedTimestamp).sourceTimeMs ||
    value.nextFundingTimeMs < value.sourceTimeMs
  ) {
    const timestampValid =
      evidence !== null &&
      publicGroundworkTimestampFresh(
        evidence.observedAt,
        nowMs,
        maximumAgeMs,
        'REQUIRED',
      );
    blockingCodes.push(
      timestampValid
        ? 'FUNDING_FORECAST_INVALID'
        : 'FUNDING_FORECAST_STALE',
    );
    return null;
  }
  if (value.symbol !== symbol) {
    blockingCodes.push('FUNDING_FORECAST_SYMBOL_MISMATCH');
  }
  return Object.freeze({
    kind: 'FORECAST_ONLY' as const,
    evidenceRevision: evidence.revision,
    observedAt: copyPublicGroundworkTimestamp(
      evidence.observedAt as SourcedTimestamp,
    ),
    value: Object.freeze({
      symbol: value.symbol,
      markPrice: value.markPrice,
      indexPrice: value.indexPrice,
      estimatedSettlePrice: value.estimatedSettlePrice,
      lastFundingRate: value.lastFundingRate,
      interestRate: value.interestRate,
      nextFundingTimeMs: value.nextFundingTimeMs,
      sourceTimeMs: value.sourceTimeMs,
    }),
    capturedAsSettlement: false as const,
  });
}

function copyFundingHistory(
  evidenceValue: unknown,
  symbol: string,
  nowMs: number,
  maximumAgeMs: number,
  blockingCodes: BinanceUsdMPublicGroundworkBlockingCode[],
): Readonly<BinanceUsdMFundingHistoryProjection> | null {
  const evidence = publicGroundworkRecord(evidenceValue);
  const timestampFresh =
    evidence !== null &&
    publicGroundworkTimestampFresh(
      evidence.observedAt,
      nowMs,
      maximumAgeMs,
      'ABSENT',
    );
  if (
    evidence === null ||
    !validPublicGroundworkRevision(evidence.revision) ||
    !timestampFresh ||
    !Array.isArray(evidence.rows) ||
    evidence.rows.length === 0 ||
    evidence.rows.length > 1_000
  ) {
    blockingCodes.push(
      timestampFresh
        ? 'FUNDING_HISTORY_INVALID'
        : 'FUNDING_HISTORY_STALE',
    );
    return null;
  }

  const rows: BinanceUsdMFundingHistoryProjectionRow[] = [];
  const fullIdentities = new Set<string>();
  const scopedIdentities = new Map<string, string>();
  for (const rowValue of evidence.rows) {
    const row = publicGroundworkRecord(rowValue);
    if (
      row === null ||
      !validPublicGroundworkSymbol(row.symbol) ||
      !publicGroundworkDecimal(row.fundingRate, 'ANY') ||
      !isValidUtcMillis(row.fundingTimeMs) ||
      row.fundingTimeMs > nowMs ||
      (row.markPrice !== null &&
        !publicGroundworkDecimal(row.markPrice, 'POSITIVE')) ||
      (row.rateType !== 'Regular' && row.rateType !== 'Special')
    ) {
      blockingCodes.push('FUNDING_HISTORY_INVALID');
      return null;
    }
    if (row.symbol !== symbol) {
      blockingCodes.push('FUNDING_HISTORY_SYMBOL_MISMATCH');
    }
    const scopeIdentity =
      `${row.symbol}\u0000${row.fundingTimeMs}\u0000${row.rateType}`;
    const fullIdentity =
      `${scopeIdentity}\u0000${row.fundingRate}\u0000${row.markPrice ?? ''}`;
    const existingFullIdentity = scopedIdentities.get(scopeIdentity);
    if (
      existingFullIdentity !== undefined &&
      existingFullIdentity !== fullIdentity
    ) {
      blockingCodes.push('FUNDING_HISTORY_CONFLICT');
    }
    if (fullIdentities.has(fullIdentity)) continue;
    fullIdentities.add(fullIdentity);
    scopedIdentities.set(scopeIdentity, fullIdentity);
    rows.push(Object.freeze({
      symbol: row.symbol,
      fundingRate: row.fundingRate,
      fundingTimeMs: row.fundingTimeMs,
      markPrice: row.markPrice,
      rateType: row.rateType,
    }));
  }
  rows.sort((left, right) => {
    if (left.fundingTimeMs !== right.fundingTimeMs) {
      return left.fundingTimeMs - right.fundingTimeMs;
    }
    if (left.rateType !== right.rateType) {
      return left.rateType === 'Regular' ? -1 : 1;
    }
    const rateOrder = compareDecimalStrings(
      left.fundingRate,
      right.fundingRate,
    );
    if (rateOrder !== 0) return rateOrder;
    if (left.markPrice === right.markPrice) return 0;
    if (left.markPrice === null) return -1;
    if (right.markPrice === null) return 1;
    return compareDecimalStrings(left.markPrice, right.markPrice);
  });

  return Object.freeze({
    kind: 'PUBLIC_SETTLEMENT_RATE_HISTORY' as const,
    evidenceRevision: evidence.revision,
    observedAt: copyPublicGroundworkTimestamp(
      evidence.observedAt as SourcedTimestamp,
    ),
    symbol,
    rows: Object.freeze(rows),
    capturesPublicSettlementRate: true as const,
    capturesAccountPayment: false as const,
  });
}

function freezePublicGroundworkResult(
  input: {
    readonly passed: boolean;
    readonly evaluatedAtMs: number | null;
    readonly symbol: string | null;
    readonly filters: Readonly<BinanceUsdMValidatedPublicFilters> | null;
    readonly fundingForecast:
      | Readonly<BinanceUsdMFundingForecastProjection>
      | null;
    readonly fundingHistory:
      | Readonly<BinanceUsdMFundingHistoryProjection>
      | null;
    readonly blockingCodes:
      readonly BinanceUsdMPublicGroundworkBlockingCode[];
  },
): Readonly<BinanceUsdMPublicGroundworkResult> {
  return Object.freeze({
    schema: BINANCE_USDM_PUBLIC_GROUNDWORK_SCHEMA,
    version: 1 as const,
    mode: 'VALIDATE_ONLY' as const,
    validationPassed: input.passed,
    evaluatedAtMs: input.evaluatedAtMs,
    symbol: input.symbol,
    filters: input.filters,
    fundingForecast: input.fundingForecast,
    fundingHistory: input.fundingHistory,
    blockingCodes: Object.freeze([...new Set(input.blockingCodes)]),
    authority: 'NONE' as const,
    externalActionAuthorization: 'NONE' as const,
    permittedExternalActions: NO_PUBLIC_GROUNDWORK_EXTERNAL_ACTIONS,
    networkRequestsPerformed: 0 as const,
    privateRequestsPerformed: 0 as const,
    signedRequestsPerformed: 0 as const,
    ordersPerformed: 0 as const,
    sideEffectsPerformed: 0 as const,
    capabilities: BINANCE_USDM_PUBLIC_GROUNDWORK_CAPABILITIES,
  });
}

function blockedPublicGroundwork(
  blockingCodes: readonly BinanceUsdMPublicGroundworkBlockingCode[],
  evaluatedAtMs: number | null = null,
  symbol: string | null = null,
): Readonly<BinanceUsdMPublicGroundworkResult> {
  return freezePublicGroundworkResult({
    passed: false,
    evaluatedAtMs,
    symbol,
    filters: null,
    fundingForecast: null,
    fundingHistory: null,
    blockingCodes,
  });
}

/**
 * Pure public-data seam for N-11. It validates already-injected source facts
 * and exposes no request, credential, signing, timer, persistence, private
 * read, test-order, order, or capital-movement capability.
 */
export function createBinanceUsdMPublicGroundworkSeam(
  config: Readonly<BinanceUsdMPublicGroundworkSeamConfig> =
    DEFAULT_BINANCE_USDM_PUBLIC_GROUNDWORK_CONFIG,
): Readonly<BinanceUsdMPublicGroundworkSeam> {
  let configSnapshot:
    | Readonly<BinanceUsdMPublicGroundworkSeamConfig>
    | null = null;
  try {
    configSnapshot = Object.freeze({
      sourceEnabled: config.sourceEnabled,
      allowedSymbols: Object.freeze([...config.allowedSymbols]),
      maximumFilterAgeMs: config.maximumFilterAgeMs,
      maximumForecastAgeMs: config.maximumForecastAgeMs,
      maximumHistoryCaptureAgeMs: config.maximumHistoryCaptureAgeMs,
    });
  } catch {
    // Any malformed/effectful-looking config remains closed.
  }
  const configValid =
    configSnapshot !== null && validPublicGroundworkConfig(configSnapshot);
  const sourceEnabled =
    configValid && configSnapshot?.sourceEnabled === true;
  const allowedSymbols = configValid
    ? configSnapshot?.allowedSymbols ?? Object.freeze([])
    : Object.freeze([] as string[]);
  const maximumFilterAgeMs =
    configSnapshot !== null && configValid
      ? configSnapshot.maximumFilterAgeMs
      : DEFAULT_BINANCE_USDM_PUBLIC_GROUNDWORK_CONFIG.maximumFilterAgeMs;
  const maximumForecastAgeMs =
    configSnapshot !== null && configValid
      ? configSnapshot.maximumForecastAgeMs
      : DEFAULT_BINANCE_USDM_PUBLIC_GROUNDWORK_CONFIG.maximumForecastAgeMs;
  const maximumHistoryCaptureAgeMs =
    configSnapshot !== null && configValid
      ? configSnapshot.maximumHistoryCaptureAgeMs
      : DEFAULT_BINANCE_USDM_PUBLIC_GROUNDWORK_CONFIG
          .maximumHistoryCaptureAgeMs;

  return Object.freeze({
    mode: 'VALIDATE_ONLY' as const,
    sourceEnabled,
    validate(
      input: Readonly<BinanceUsdMPublicGroundworkInput>,
    ): Readonly<BinanceUsdMPublicGroundworkResult> {
      if (!configValid) return blockedPublicGroundwork(['CONFIG_INVALID']);
      if (!sourceEnabled) return blockedPublicGroundwork(['SOURCE_DISABLED']);

      try {
        const value = publicGroundworkRecord(input);
        if (value === null) return blockedPublicGroundwork(['INPUT_INVALID']);
        const nowMs = value.nowMs;
        const symbol = value.symbol;
        if (!isValidUtcMillis(nowMs)) {
          return blockedPublicGroundwork(['EVALUATION_TIME_INVALID']);
        }
        if (value.currentEffectiveKillSwitchEngaged !== false) {
          return blockedPublicGroundwork(
            ['KILL_SWITCH_ENGAGED_OR_UNKNOWN'],
            nowMs,
            validPublicGroundworkSymbol(symbol) ? symbol : null,
          );
        }
        if (!validPublicGroundworkSymbol(symbol)) {
          return blockedPublicGroundwork(['SYMBOL_INVALID'], nowMs);
        }

        const blockingCodes:
          BinanceUsdMPublicGroundworkBlockingCode[] = [];
        if (!allowedSymbols.includes(symbol)) {
          blockingCodes.push('SYMBOL_NOT_ALLOWLISTED');
        }

        const exchangeSymbol = publicGroundworkRecord(value.exchangeSymbol);
        let filters: Readonly<BinanceUsdMValidatedPublicFilters> | null = null;
        if (
          exchangeSymbol === null ||
          !validPublicGroundworkSymbol(exchangeSymbol.symbol) ||
          typeof exchangeSymbol.status !== 'string' ||
          !Array.isArray(exchangeSymbol.orderTypes) ||
          !exchangeSymbol.orderTypes.every(
            (item) =>
              typeof item === 'string' &&
              /^[A-Z0-9_]{1,64}$/.test(item),
          ) ||
          !publicGroundworkTimestampFresh(
            exchangeSymbol.observedAt,
            nowMs,
            maximumFilterAgeMs,
            'ANY',
          )
        ) {
          const timestampValid =
            exchangeSymbol !== null &&
            publicGroundworkTimestampFresh(
              exchangeSymbol.observedAt,
              nowMs,
              maximumFilterAgeMs,
              'ANY',
            );
          blockingCodes.push(
            timestampValid
              ? 'EXCHANGE_SYMBOL_INVALID'
              : 'EXCHANGE_SYMBOL_STALE',
          );
        } else {
          if (exchangeSymbol.symbol !== symbol) {
            blockingCodes.push('EXCHANGE_SYMBOL_MISMATCH');
          }
          if (exchangeSymbol.status !== 'TRADING') {
            blockingCodes.push('SYMBOL_NOT_TRADING');
          }
          if (!exchangeSymbol.orderTypes.includes('MARKET')) {
            blockingCodes.push('SYMBOL_MARKET_ORDER_UNSUPPORTED');
          }
          filters = copyPublicGroundworkFilters(
            exchangeSymbol.filters,
            exchangeSymbol.observedAt as SourcedTimestamp,
            blockingCodes,
          );
        }

        const fundingForecast = copyFundingForecast(
          value.fundingForecast,
          symbol,
          nowMs,
          maximumForecastAgeMs,
          blockingCodes,
        );
        const fundingHistory = copyFundingHistory(
          value.fundingHistory,
          symbol,
          nowMs,
          maximumHistoryCaptureAgeMs,
          blockingCodes,
        );
        const validationPassed = blockingCodes.length === 0;
        return freezePublicGroundworkResult({
          passed: validationPassed,
          evaluatedAtMs: nowMs,
          symbol,
          filters,
          fundingForecast,
          fundingHistory,
          blockingCodes,
        });
      } catch {
        return blockedPublicGroundwork(['INPUT_INVALID']);
      }
    },
  });
}
