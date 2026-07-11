/**
 * Live-wiring adapter INTERFACES + pure Binance payload mappers.
 * Per VOLUME_RESEARCH_NOTES.md the live pass will feed:
 *   universe tier → !miniTicker@arr (1 stream, 1s cadence)
 *   candidate tier → <sym>@aggTrade + <sym>@bookTicker
 *   focus tier → + <sym>@depth20@100ms
 * This pass ships shapes and mappers only — NO network code, NO ws import.
 * Tests exercise the mappers with fixture payloads.
 */
import type { BookTicker, TradeTick } from '../v0/types.js';
import { isCanonicalSymbol, positive } from './validation.js';

// ---------- raw Binance payload shapes (spot, verified 2026-07) ----------

/** <symbol>@aggTrade */
export interface RawAggTrade {
  e: 'aggTrade';
  E: number; // event time
  s: string; // symbol
  a: number; // aggTrade id
  p: string; // price
  q: string; // quantity (base)
  f: number; // first tradeId
  l: number; // last tradeId
  T: number; // trade time
  m: boolean; // buyer is maker → taker SOLD
}

/** <symbol>@bookTicker — NOTE: spot bookTicker carries NO event time; the
 * receiver must stamp local receive time. */
export interface RawBookTicker {
  u: number; // orderbook updateId
  s: string;
  b: string; // best bid price
  B: string; // best bid qty
  a: string; // best ask price
  A: string; // best ask qty
}

/** element of !miniTicker@arr */
export interface RawMiniTicker {
  e: '24hrMiniTicker';
  E: number;
  s: string;
  c: string; // close
  o: string; // open
  h: string;
  l: string;
  v: string; // 24h base volume (rolling)
  q: string; // 24h quote volume (rolling)
}

// ---------- pure mappers ----------

export function mapAggTrade(raw: RawAggTrade): { tick: TradeTick; printCount: number } {
  const price = Number(raw.p);
  const qty = Number(raw.q);
  if (
    raw.e !== 'aggTrade' ||
    !isCanonicalSymbol(raw.s) ||
    !positive(price) ||
    !positive(qty) ||
    !Number.isSafeInteger(raw.T) || raw.T < 0 ||
    !Number.isSafeInteger(raw.f) || !Number.isSafeInteger(raw.l) || raw.f < 0 || raw.l < raw.f ||
    typeof raw.m !== 'boolean'
  ) {
    throw new TypeError('invalid aggregate trade payload');
  }
  const quoteQty = price * qty;
  if (!positive(quoteQty)) throw new TypeError('invalid aggregate trade notional');
  return {
    tick: {
      symbol: raw.s,
      price,
      qty,
      quoteQty,
      isBuyerMaker: raw.m,
      ts: raw.T,
    },
    printCount: Math.max(1, raw.l - raw.f + 1),
  };
}

export function mapBookTicker(raw: RawBookTicker, receivedTs: number): BookTicker {
  const mapped = {
    symbol: raw.s,
    bid: Number(raw.b),
    ask: Number(raw.a),
    bidQty: Number(raw.B),
    askQty: Number(raw.A),
    ts: receivedTs,
  };
  if (
    !isCanonicalSymbol(mapped.symbol) ||
    !positive(mapped.bid) ||
    !positive(mapped.ask) ||
    mapped.bid >= mapped.ask ||
    !positive(mapped.bidQty) ||
    !positive(mapped.askQty) ||
    !Number.isSafeInteger(mapped.ts) || mapped.ts < 0
  ) {
    throw new TypeError('invalid book ticker payload');
  }
  return mapped;
}

/**
 * Universe-tier volume from consecutive miniTicker frames: the 24h rolling
 * quote volume delta over one second ≈ quote volume traded that second.
 * Produces ONE synthetic aggregate tick (printCount unknown → 0 marker means
 * "aggregate of unknown prints"; the detector must not run one-print/wash
 * forensics on universe-tier data — those need real aggTrade, which arrives
 * after candidate promotion).
 */
export function miniTickerDelta(prev: RawMiniTicker, cur: RawMiniTicker): TradeTick | null {
  if (
    !isCanonicalSymbol(prev.s) ||
    cur.s !== prev.s ||
    !Number.isSafeInteger(prev.E) || !Number.isSafeInteger(cur.E) ||
    cur.E <= prev.E
  ) return null;
  const dq = Number(cur.q) - Number(prev.q);
  if (!positive(dq)) return null; // rolling window can shrink; never fabricate volume
  const price = Number(cur.c);
  if (!positive(price)) return null;
  return {
    symbol: cur.s,
    price,
    qty: dq / price,
    quoteQty: dq,
    isBuyerMaker: false, // unknown at this tier; taker ratio stays null via printCount=0 path
    ts: cur.E,
  };
}

// ---------- source interfaces the live pass will implement ----------

export interface TradeSource {
  subscribe(symbols: string[]): void;
  unsubscribe(symbols: string[]): void;
  onTrade(cb: (tick: TradeTick, printCount: number) => void): void;
}

export interface BookSource {
  subscribe(symbols: string[]): void;
  unsubscribe(symbols: string[]): void;
  onBook(cb: (book: BookTicker) => void): void;
}

export interface UniverseVolumeSource {
  /** universe-wide 1s volume deltas (miniTicker-arr backed) */
  onDelta(cb: (tick: TradeTick) => void): void;
}
