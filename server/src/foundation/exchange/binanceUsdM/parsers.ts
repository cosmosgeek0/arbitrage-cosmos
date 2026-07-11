import { validateSourcedTimestamp, isValidUtcMillis, type SourcedTimestamp } from '../../contracts/index.js';
import { compareDecimalStrings, normalizeDecimalString } from './decimal.js';
import type {
  BinanceUsdMAccount,
  BinanceUsdMAccountAsset,
  BinanceUsdMAccountPosition,
  BinanceUsdMBalance,
  BinanceUsdMExchangeInfo,
  BinanceUsdMExchangeSymbol,
  BinanceUsdMFundingRate,
  BinanceUsdMLotSizeFilter,
  BinanceUsdMMarkFunding,
  BinanceUsdMOrder,
  BinanceUsdMPosition,
  BinanceUsdMPercentPriceFilter,
  BinanceUsdMPriceFilter,
  BinanceUsdMRateLimitMetadata,
  BinanceUsdMRateLimitRule,
  BinanceUsdMTestOrderAccepted,
  BinanceUsdMTrade,
} from './types.js';

const MAX_ROWS = 20_000;
const POSITION_SIDES = new Set(['BOTH', 'LONG', 'SHORT']);
const ORDER_SIDES = new Set(['BUY', 'SELL']);
const ORDER_STATUSES = new Set([
  'NEW', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH',
  'NEW_INSURANCE', 'NEW_ADL',
]);
const TIME_IN_FORCE = new Set(['GTC', 'IOC', 'FOK', 'GTX', 'GTD', 'RPI', '']);
const ORDER_TYPES = new Set([
  'LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET',
  'LIQUIDATION',
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rows(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  return value;
}

function text(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > 256 || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${label} must be a bounded string`);
  }
  return value;
}

function decimal(value: unknown, label: string): string {
  try {
    return normalizeDecimalString(value);
  } catch {
    throw new TypeError(`${label} must be a decimal string`);
  }
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a safe integer`);
  }
  return value;
}

function utc(value: unknown, label: string): number {
  if (!isValidUtcMillis(value)) throw new TypeError(`${label} must be valid UTC milliseconds`);
  return value;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

function enumeration(value: unknown, label: string, allowed: ReadonlySet<string>): string {
  const parsed = text(value, label, allowed.has(''));
  if (!allowed.has(parsed)) throw new TypeError(`${label} has an unknown enum value`);
  return parsed;
}

function stringArray(value: unknown, label: string): readonly string[] {
  const parsed = rows(value, label).map((item, index) => text(item, `${label}[${index}]`));
  return Object.freeze(parsed);
}

function parsePriceFilter(value: Record<string, unknown>, label: string): BinanceUsdMPriceFilter {
  const minPrice = decimal(value.minPrice, `${label}.minPrice`);
  const maxPrice = decimal(value.maxPrice, `${label}.maxPrice`);
  const tickSize = decimal(value.tickSize, `${label}.tickSize`);
  if (
    compareDecimalStrings(minPrice, '0') < 0 ||
    compareDecimalStrings(maxPrice, '0') < 0 ||
    compareDecimalStrings(tickSize, '0') < 0 ||
    (compareDecimalStrings(maxPrice, '0') > 0 && compareDecimalStrings(minPrice, maxPrice) > 0)
  ) throw new TypeError(`${label} has a negative or incoherent domain`);
  return Object.freeze({ minPrice, maxPrice, tickSize });
}

function parseLotFilter(value: Record<string, unknown>, label: string): BinanceUsdMLotSizeFilter {
  const minQty = decimal(value.minQty, `${label}.minQty`);
  const maxQty = decimal(value.maxQty, `${label}.maxQty`);
  const stepSize = decimal(value.stepSize, `${label}.stepSize`);
  if (
    compareDecimalStrings(minQty, '0') <= 0 ||
    compareDecimalStrings(maxQty, '0') <= 0 ||
    compareDecimalStrings(stepSize, '0') <= 0 ||
    compareDecimalStrings(minQty, maxQty) > 0
  ) throw new TypeError(`${label} has a non-positive or incoherent domain`);
  return Object.freeze({ minQty, maxQty, stepSize });
}

function parsePercentPriceFilter(value: Record<string, unknown>, label: string): BinanceUsdMPercentPriceFilter {
  const multiplierUp = decimal(value.multiplierUp, `${label}.multiplierUp`);
  const multiplierDown = decimal(value.multiplierDown, `${label}.multiplierDown`);
  if (
    compareDecimalStrings(multiplierUp, '0') <= 0 ||
    compareDecimalStrings(multiplierDown, '0') <= 0 ||
    compareDecimalStrings(multiplierDown, multiplierUp) > 0
  ) throw new TypeError(`${label} has a non-positive or incoherent domain`);
  return Object.freeze({ multiplierUp, multiplierDown });
}

function parseSymbol(
  value: unknown,
  index: number,
  observedAt: Readonly<SourcedTimestamp>,
): BinanceUsdMExchangeSymbol {
  const row = record(value, `symbols[${index}]`);
  let price: BinanceUsdMPriceFilter | null = null;
  let lotSize: BinanceUsdMLotSizeFilter | null = null;
  let marketLotSize: BinanceUsdMLotSizeFilter | null = null;
  let minNotional: string | null = null;
  let percentPrice: BinanceUsdMPercentPriceFilter | null = null;
  for (const [filterIndex, rawFilter] of rows(row.filters, `symbols[${index}].filters`).entries()) {
    const filter = record(rawFilter, `symbols[${index}].filters[${filterIndex}]`);
    const type = text(filter.filterType, `symbols[${index}].filters[${filterIndex}].filterType`);
    if (type === 'PRICE_FILTER') {
      if (price !== null) throw new TypeError('duplicate PRICE_FILTER');
      price = parsePriceFilter(filter, `symbols[${index}].filters[${filterIndex}]`);
    } else if (type === 'LOT_SIZE') {
      if (lotSize !== null) throw new TypeError('duplicate LOT_SIZE');
      lotSize = parseLotFilter(filter, `symbols[${index}].filters[${filterIndex}]`);
    } else if (type === 'MARKET_LOT_SIZE') {
      if (marketLotSize !== null) throw new TypeError('duplicate MARKET_LOT_SIZE');
      marketLotSize = parseLotFilter(filter, `symbols[${index}].filters[${filterIndex}]`);
    } else if (type === 'MIN_NOTIONAL') {
      if (minNotional !== null) throw new TypeError('duplicate MIN_NOTIONAL');
      minNotional = decimal(filter.notional, `symbols[${index}].filters[${filterIndex}].notional`);
      if (compareDecimalStrings(minNotional, '0') < 0) throw new TypeError('MIN_NOTIONAL cannot be negative');
    } else if (type === 'PERCENT_PRICE') {
      if (percentPrice !== null) throw new TypeError('duplicate PERCENT_PRICE');
      percentPrice = parsePercentPriceFilter(filter, `symbols[${index}].filters[${filterIndex}]`);
    }
  }
  return Object.freeze({
    symbol: text(row.symbol, `symbols[${index}].symbol`),
    status: text(row.status, `symbols[${index}].status`),
    baseAsset: text(row.baseAsset, `symbols[${index}].baseAsset`),
    quoteAsset: text(row.quoteAsset, `symbols[${index}].quoteAsset`),
    marginAsset: text(row.marginAsset, `symbols[${index}].marginAsset`),
    orderTypes: stringArray(row.orderTypes, `symbols[${index}].orderTypes`),
    timeInForce: stringArray(row.timeInForce, `symbols[${index}].timeInForce`),
    filters: Object.freeze({ price, lotSize, marketLotSize, minNotional, percentPrice }),
    observedAt,
  });
}

export function parseServerTime(body: unknown): number {
  return utc(record(body, 'serverTime response').serverTime, 'serverTime');
}

export function parseExchangeInfo(
  body: unknown,
  observedAt: Readonly<SourcedTimestamp>,
): BinanceUsdMExchangeInfo {
  if (validateSourcedTimestamp(observedAt).length > 0) {
    throw new TypeError('exchangeInfo observation provenance is malformed');
  }
  const source = record(body, 'exchangeInfo response');
  const limits: BinanceUsdMRateLimitRule[] = rows(source.rateLimits, 'rateLimits').map((value, index) => {
    const row = record(value, `rateLimits[${index}]`);
    return Object.freeze({
      rateLimitType: text(row.rateLimitType, `rateLimits[${index}].rateLimitType`),
      interval: text(row.interval, `rateLimits[${index}].interval`),
      intervalNum: integer(row.intervalNum, `rateLimits[${index}].intervalNum`, 1),
      limit: integer(row.limit, `rateLimits[${index}].limit`, 1),
    });
  });
  const symbols = rows(source.symbols, 'symbols').map((value, index) => parseSymbol(value, index, observedAt));
  return Object.freeze({
    timezone: text(source.timezone, 'timezone'),
    rateLimits: Object.freeze(limits),
    symbols: Object.freeze(symbols),
  });
}

export function parseMarkFunding(body: unknown, expectedSymbol: string): BinanceUsdMMarkFunding {
  const source = record(body, 'mark/funding response');
  const symbol = text(source.symbol, 'symbol');
  if (symbol !== expectedSymbol) throw new TypeError('mark/funding symbol does not match request');
  return Object.freeze({
    symbol,
    markPrice: decimal(source.markPrice, 'markPrice'),
    indexPrice: decimal(source.indexPrice, 'indexPrice'),
    estimatedSettlePrice: decimal(source.estimatedSettlePrice, 'estimatedSettlePrice'),
    lastFundingRate: decimal(source.lastFundingRate, 'lastFundingRate'),
    interestRate: decimal(source.interestRate, 'interestRate'),
    nextFundingTimeMs: utc(source.nextFundingTime, 'nextFundingTime'),
    sourceTimeMs: utc(source.time, 'time'),
  });
}

export function parseFundingRates(body: unknown, expectedSymbol: string | null): readonly BinanceUsdMFundingRate[] {
  const parsed = rows(body, 'funding rate response').map((value, index) => {
    const row = record(value, `fundingRates[${index}]`);
    const symbol = text(row.symbol, `fundingRates[${index}].symbol`);
    if (expectedSymbol !== null && symbol !== expectedSymbol) throw new TypeError('funding-rate symbol does not match request');
    return Object.freeze({
      symbol,
      fundingRate: decimal(row.fundingRate, `fundingRates[${index}].fundingRate`),
      fundingTimeMs: utc(row.fundingTime, `fundingRates[${index}].fundingTime`),
      markPrice: row.markPrice === undefined ? null : decimal(row.markPrice, `fundingRates[${index}].markPrice`),
    });
  });
  return Object.freeze(parsed);
}

function parseAccountAsset(value: unknown, index: number): BinanceUsdMAccountAsset {
  const row = record(value, `assets[${index}]`);
  return Object.freeze({
    asset: text(row.asset, `assets[${index}].asset`),
    walletBalance: decimal(row.walletBalance, `assets[${index}].walletBalance`),
    unrealizedProfit: decimal(row.unrealizedProfit, `assets[${index}].unrealizedProfit`),
    marginBalance: decimal(row.marginBalance, `assets[${index}].marginBalance`),
    availableBalance: decimal(row.availableBalance, `assets[${index}].availableBalance`),
    maxWithdrawAmount: decimal(row.maxWithdrawAmount, `assets[${index}].maxWithdrawAmount`),
    updateTimeMs: utc(row.updateTime, `assets[${index}].updateTime`),
  });
}

function parseAccountPosition(value: unknown, index: number): BinanceUsdMAccountPosition {
  const row = record(value, `positions[${index}]`);
  return Object.freeze({
    symbol: text(row.symbol, `positions[${index}].symbol`),
    positionSide: enumeration(row.positionSide, `positions[${index}].positionSide`, POSITION_SIDES),
    positionAmt: decimal(row.positionAmt, `positions[${index}].positionAmt`),
    unrealizedProfit: decimal(row.unrealizedProfit, `positions[${index}].unrealizedProfit`),
    isolatedMargin: decimal(row.isolatedMargin, `positions[${index}].isolatedMargin`),
    notional: decimal(row.notional, `positions[${index}].notional`),
    isolatedWallet: decimal(row.isolatedWallet, `positions[${index}].isolatedWallet`),
    initialMargin: decimal(row.initialMargin, `positions[${index}].initialMargin`),
    maintMargin: decimal(row.maintMargin, `positions[${index}].maintMargin`),
    updateTimeMs: utc(row.updateTime, `positions[${index}].updateTime`),
  });
}

export function parseAccount(body: unknown): BinanceUsdMAccount {
  const row = record(body, 'account response');
  return Object.freeze({
    totalInitialMargin: decimal(row.totalInitialMargin, 'totalInitialMargin'),
    totalMaintMargin: decimal(row.totalMaintMargin, 'totalMaintMargin'),
    totalWalletBalance: decimal(row.totalWalletBalance, 'totalWalletBalance'),
    totalUnrealizedProfit: decimal(row.totalUnrealizedProfit, 'totalUnrealizedProfit'),
    totalMarginBalance: decimal(row.totalMarginBalance, 'totalMarginBalance'),
    totalPositionInitialMargin: decimal(row.totalPositionInitialMargin, 'totalPositionInitialMargin'),
    totalOpenOrderInitialMargin: decimal(row.totalOpenOrderInitialMargin, 'totalOpenOrderInitialMargin'),
    totalCrossWalletBalance: decimal(row.totalCrossWalletBalance, 'totalCrossWalletBalance'),
    totalCrossUnPnl: decimal(row.totalCrossUnPnl, 'totalCrossUnPnl'),
    availableBalance: decimal(row.availableBalance, 'availableBalance'),
    maxWithdrawAmount: decimal(row.maxWithdrawAmount, 'maxWithdrawAmount'),
    assets: Object.freeze(rows(row.assets, 'assets').map(parseAccountAsset)),
    positions: Object.freeze(rows(row.positions, 'positions').map(parseAccountPosition)),
  });
}

export function parseBalances(body: unknown): readonly BinanceUsdMBalance[] {
  return Object.freeze(rows(body, 'balance response').map((value, index) => {
    const row = record(value, `balances[${index}]`);
    return Object.freeze({
      accountAlias: text(row.accountAlias, `balances[${index}].accountAlias`),
      asset: text(row.asset, `balances[${index}].asset`),
      balance: decimal(row.balance, `balances[${index}].balance`),
      crossWalletBalance: decimal(row.crossWalletBalance, `balances[${index}].crossWalletBalance`),
      crossUnPnl: decimal(row.crossUnPnl, `balances[${index}].crossUnPnl`),
      availableBalance: decimal(row.availableBalance, `balances[${index}].availableBalance`),
      maxWithdrawAmount: decimal(row.maxWithdrawAmount, `balances[${index}].maxWithdrawAmount`),
      marginAvailable: row.marginAvailable === undefined ? null : bool(row.marginAvailable, `balances[${index}].marginAvailable`),
      updateTimeMs: utc(row.updateTime, `balances[${index}].updateTime`),
    });
  }));
}

export function parsePositions(body: unknown, expectedSymbol: string | null): readonly BinanceUsdMPosition[] {
  return Object.freeze(rows(body, 'position response').map((value, index) => {
    const row = record(value, `positions[${index}]`);
    const symbol = text(row.symbol, `positions[${index}].symbol`);
    if (expectedSymbol !== null && symbol !== expectedSymbol) throw new TypeError('position symbol does not match request');
    return Object.freeze({
      symbol,
      positionSide: enumeration(row.positionSide, `positions[${index}].positionSide`, POSITION_SIDES),
      positionAmt: decimal(row.positionAmt, `positions[${index}].positionAmt`),
      entryPrice: decimal(row.entryPrice, `positions[${index}].entryPrice`),
      breakEvenPrice: decimal(row.breakEvenPrice, `positions[${index}].breakEvenPrice`),
      markPrice: decimal(row.markPrice, `positions[${index}].markPrice`),
      unrealizedProfit: decimal(row.unRealizedProfit, `positions[${index}].unRealizedProfit`),
      liquidationPrice: decimal(row.liquidationPrice, `positions[${index}].liquidationPrice`),
      isolatedMargin: decimal(row.isolatedMargin, `positions[${index}].isolatedMargin`),
      notional: decimal(row.notional, `positions[${index}].notional`),
      marginAsset: text(row.marginAsset, `positions[${index}].marginAsset`),
      isolatedWallet: decimal(row.isolatedWallet, `positions[${index}].isolatedWallet`),
      initialMargin: decimal(row.initialMargin, `positions[${index}].initialMargin`),
      maintMargin: decimal(row.maintMargin, `positions[${index}].maintMargin`),
      updateTimeMs: utc(row.updateTime, `positions[${index}].updateTime`),
    });
  }));
}

export function parseOrder(value: unknown, expectedSymbol: string): BinanceUsdMOrder {
  const row = record(value, 'order response');
  const symbol = text(row.symbol, 'symbol');
  if (symbol !== expectedSymbol) throw new TypeError('order symbol does not match request');
  return Object.freeze({
    symbol,
    orderId: integer(row.orderId, 'orderId'),
    clientOrderId: text(row.clientOrderId, 'clientOrderId'),
    price: decimal(row.price, 'price'),
    avgPrice: decimal(row.avgPrice, 'avgPrice'),
    origQty: decimal(row.origQty, 'origQty'),
    executedQty: decimal(row.executedQty, 'executedQty'),
    cumQuote: decimal(row.cumQuote, 'cumQuote'),
    status: enumeration(row.status, 'status', ORDER_STATUSES),
    timeInForce: enumeration(row.timeInForce, 'timeInForce', TIME_IN_FORCE),
    type: enumeration(row.type, 'type', ORDER_TYPES),
    origType: enumeration(row.origType, 'origType', ORDER_TYPES),
    side: enumeration(row.side, 'side', ORDER_SIDES),
    positionSide: enumeration(row.positionSide, 'positionSide', POSITION_SIDES),
    reduceOnly: bool(row.reduceOnly, 'reduceOnly'),
    closePosition: bool(row.closePosition, 'closePosition'),
    stopPrice: decimal(row.stopPrice, 'stopPrice'),
    timeMs: utc(row.time, 'time'),
    updateTimeMs: utc(row.updateTime, 'updateTime'),
  });
}

export function parseOrders(body: unknown, expectedSymbol: string | null): readonly BinanceUsdMOrder[] {
  const parsed = rows(body, 'open orders response').map((value) => {
    const symbol = text(record(value, 'open order').symbol, 'symbol');
    if (expectedSymbol !== null && symbol !== expectedSymbol) throw new TypeError('open-order symbol does not match request');
    return parseOrder(value, symbol);
  });
  return Object.freeze(parsed);
}

export function parseTrades(body: unknown, expectedSymbol: string): readonly BinanceUsdMTrade[] {
  return Object.freeze(rows(body, 'user trades response').map((value, index) => {
    const row = record(value, `trades[${index}]`);
    const symbol = text(row.symbol, `trades[${index}].symbol`);
    if (symbol !== expectedSymbol) throw new TypeError('trade symbol does not match request');
    return Object.freeze({
      symbol,
      id: integer(row.id, `trades[${index}].id`),
      orderId: integer(row.orderId, `trades[${index}].orderId`),
      price: decimal(row.price, `trades[${index}].price`),
      qty: decimal(row.qty, `trades[${index}].qty`),
      quoteQty: decimal(row.quoteQty, `trades[${index}].quoteQty`),
      commission: decimal(row.commission, `trades[${index}].commission`),
      commissionAsset: text(row.commissionAsset, `trades[${index}].commissionAsset`),
      realizedPnl: decimal(row.realizedPnl, `trades[${index}].realizedPnl`),
      side: enumeration(row.side, `trades[${index}].side`, ORDER_SIDES),
      positionSide: enumeration(row.positionSide, `trades[${index}].positionSide`, POSITION_SIDES),
      buyer: bool(row.buyer, `trades[${index}].buyer`),
      maker: bool(row.maker, `trades[${index}].maker`),
      timeMs: utc(row.time, `trades[${index}].time`),
    });
  }));
}

export function parseTestOrder(body: unknown, expectedSymbol: string): BinanceUsdMTestOrderAccepted {
  const row = record(body, 'test-order response');
  const symbol = text(row.symbol, 'test-order.symbol');
  if (symbol !== expectedSymbol) throw new TypeError('test-order symbol does not match request');
  // Validate the current documented response rather than treating any object
  // (including an empty/fake-success object) as venue acceptance.
  const venueOrderId = integer(row.orderId, 'test-order.orderId');
  const venueClientOrderId = text(row.clientOrderId, 'test-order.clientOrderId');
  decimal(row.cumQty, 'test-order.cumQty');
  decimal(row.cumQuote, 'test-order.cumQuote');
  decimal(row.executedQty, 'test-order.executedQty');
  decimal(row.avgPrice, 'test-order.avgPrice');
  decimal(row.origQty, 'test-order.origQty');
  decimal(row.price, 'test-order.price');
  bool(row.reduceOnly, 'test-order.reduceOnly');
  enumeration(row.side, 'test-order.side', ORDER_SIDES);
  enumeration(row.positionSide, 'test-order.positionSide', POSITION_SIDES);
  enumeration(row.status, 'test-order.status', ORDER_STATUSES);
  decimal(row.stopPrice, 'test-order.stopPrice');
  bool(row.closePosition, 'test-order.closePosition');
  enumeration(row.timeInForce, 'test-order.timeInForce', TIME_IN_FORCE);
  enumeration(row.type, 'test-order.type', ORDER_TYPES);
  enumeration(row.origType, 'test-order.origType', ORDER_TYPES);
  const updateTimeMs = utc(row.updateTime, 'test-order.updateTime');
  return Object.freeze({
    validationAccepted: true as const,
    submittedToMatchingEngine: false as const,
    endpoint: '/fapi/v1/order/test' as const,
    symbol,
    venueOrderId,
    venueClientOrderId,
    updateTimeMs,
  });
}

function safeHeaderInteger(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,15}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseRateLimitHeaders(
  headers: Readonly<Record<string, string>> | null | undefined,
): Omit<BinanceUsdMRateLimitMetadata, 'cooldownUntilMs' | 'cooldownSource'> {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) lower[key.toLowerCase()] = value;
  const retrySeconds = safeHeaderInteger(lower['retry-after']);
  return Object.freeze({
    usedWeight1m: safeHeaderInteger(lower['x-mbx-used-weight-1m']),
    orderCount10s: safeHeaderInteger(lower['x-mbx-order-count-10s']),
    orderCount1m: safeHeaderInteger(lower['x-mbx-order-count-1m']),
    retryAfterMs: retrySeconds !== null && retrySeconds <= 259_200 ? retrySeconds * 1_000 : null,
  });
}

export function parseVenueError(body: unknown): { readonly code: number | null; readonly message: string | null } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return Object.freeze({ code: null, message: null });
  const row = body as Record<string, unknown>;
  let code: number | null = null;
  if (typeof row.code === 'number' && Number.isSafeInteger(row.code)) code = row.code;
  else if (typeof row.code === 'string' && /^-?\d{1,10}$/.test(row.code)) {
    const parsed = Number(row.code);
    if (Number.isSafeInteger(parsed)) code = parsed;
  }
  let message: string | null = null;
  if (typeof row.msg === 'string') {
    // Only a conservative printable subset crosses the boundary.
    message = row.msg.replace(/[^\x20-\x7E]/g, '?').slice(0, 300);
  }
  return Object.freeze({ code, message });
}
