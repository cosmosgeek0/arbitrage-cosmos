import type { BookTicker, SymbolMeta, TradeTick } from '../v0/types.js';
import type { SeedMinute } from './rolling.js';

export const MAX_ENGINE_SYMBOLS = 4_096;
export const MAX_FUTURE_SKEW_MS = 5_000;
const MAX_PRICE = 1_000_000_000_000_000;
const MAX_QUANTITY = 1_000_000_000_000_000_000_000_000;
const MAX_QUOTE_VALUE = 1_000_000_000_000_000_000;

const SYMBOL_PATTERN = /^[A-Z0-9]{1,32}$/;

export function isCanonicalSymbol(value: unknown): value is string {
  return typeof value === 'string' && SYMBOL_PATTERN.test(value);
}

export function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

export function nonNegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}

export function validTimestamp(ts: unknown, now: number, maxAgeMs: number): ts is number {
  return (
    finite(ts) &&
    Number.isSafeInteger(ts) &&
    ts >= 0 &&
    ts <= now + MAX_FUTURE_SKEW_MS &&
    now - ts <= maxAgeMs
  );
}

export function validTradeTick(
  tick: TradeTick,
  now: number,
  maxAgeMs: number,
  lastTs: number | null,
): boolean {
  if (
    !isCanonicalSymbol(tick.symbol) ||
    !positive(tick.price) ||
    tick.price > MAX_PRICE ||
    !positive(tick.qty) ||
    tick.qty > MAX_QUANTITY ||
    !positive(tick.quoteQty) ||
    tick.quoteQty > MAX_QUOTE_VALUE ||
    typeof tick.isBuyerMaker !== 'boolean' ||
    !validTimestamp(tick.ts, now, maxAgeMs) ||
    (lastTs !== null && tick.ts < lastTs)
  ) {
    return false;
  }

  // Never let a malformed quote quantity manufacture a volume spike. Binance
  // sends price and base quantity, so their product is the authoritative quote
  // amount. A small tolerance accommodates decimal parsing/rounding only.
  const expectedQuote = tick.price * tick.qty;
  if (!positive(expectedQuote)) return false;
  const tolerance = Math.max(1e-8, expectedQuote * 1e-6);
  return Math.abs(tick.quoteQty - expectedQuote) <= tolerance;
}

export function validBookTicker(
  book: BookTicker,
  now: number,
  maxAgeMs: number,
  lastTs: number | null,
): boolean {
  return (
    isCanonicalSymbol(book.symbol) &&
    positive(book.bid) &&
    book.bid <= MAX_PRICE &&
    positive(book.ask) &&
    book.ask <= MAX_PRICE &&
    book.bid < book.ask &&
    positive(book.bidQty) &&
    book.bidQty <= MAX_QUANTITY &&
    positive(book.askQty) &&
    book.askQty <= MAX_QUANTITY &&
    validTimestamp(book.ts, now, maxAgeMs) &&
    (lastTs === null || book.ts >= lastTs)
  );
}

export function validSeedMinute(sample: SeedMinute, now: number, windowMinutes: number): boolean {
  if (
    !finite(sample.startMs) ||
    !Number.isSafeInteger(sample.startMs) ||
    sample.startMs < 0 ||
    sample.startMs >= Math.floor(now / 60_000) * 60_000 ||
    now - sample.startMs > (windowMinutes + 2) * 60_000 ||
    !nonNegative(sample.quoteVolume) ||
    sample.quoteVolume > MAX_QUOTE_VALUE ||
    !nonNegative(sample.tradeCount) ||
    !Number.isSafeInteger(sample.tradeCount) ||
    !nonNegative(sample.takerBuyQuote) ||
    sample.takerBuyQuote > sample.quoteVolume ||
    !positive(sample.open) ||
    sample.open > MAX_PRICE ||
    !positive(sample.close) ||
    sample.close > MAX_PRICE ||
    !positive(sample.high) ||
    sample.high > MAX_PRICE ||
    !positive(sample.low) ||
    sample.low > MAX_PRICE ||
    sample.low > sample.high ||
    sample.open < sample.low ||
    sample.open > sample.high ||
    sample.close < sample.low ||
    sample.close > sample.high
  ) {
    return false;
  }
  return true;
}

export function validSymbolMeta(meta: SymbolMeta): boolean {
  const optionalNonNegative = (value: number | null) => value === null || nonNegative(value);
  return (
    isCanonicalSymbol(meta.symbol) &&
    typeof meta.base === 'string' &&
    meta.base.length > 0 &&
    meta.base.length <= 24 &&
    meta.quote === 'USDT' &&
    typeof meta.hasSpot === 'boolean' &&
    typeof meta.hasPerp === 'boolean' &&
    (meta.marginBorrowable === null || typeof meta.marginBorrowable === 'boolean') &&
    optionalNonNegative(meta.minNotionalUsd) &&
    optionalNonNegative(meta.tickSize) &&
    optionalNonNegative(meta.stepSize) &&
    optionalNonNegative(meta.quoteVolume24hUsd) &&
    typeof meta.eligible === 'boolean' &&
    (!meta.eligible || meta.hasSpot) &&
    (meta.ineligibleReason === null || (typeof meta.ineligibleReason === 'string' && meta.ineligibleReason.length <= 256))
  );
}
