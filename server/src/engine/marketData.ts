import { BinanceStream, type FeedStatus } from '../binance/ws.js';
import { fetchExchangeUniverse, fetchOpenInterest, type SymbolFilters } from '../binance/rest.js';
import type { Ledger } from '../ledger.js';
import type { SymbolRow } from '../types.js';

interface FeatureEntry {
  symbol: string;
  base: string;
  spotLast: number | null;
  spotOpen24h: number | null;
  spotHigh24h: number | null;
  spotLow24h: number | null;
  spotQuoteVol24h: number | null;
  perpMark: number | null;
  perpIndexPrice: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
  openInterest: number | null;
  openInterestUsd: number | null;
  openInterestChangePct: number | null;
  openInterestUpdatedAt: number | null;
}

interface SpotMiniTicker {
  E: number;
  s: string;
  c: string;
  o: string;
  h: string;
  l: string;
  q: string;
}

interface MarkPriceUpdate {
  E: number;
  s: string;
  p: string;
  i?: string;
  r?: string;
  T?: number;
}

interface ForceOrderUpdate {
  e?: string;
  E?: number;
  st?: number;
  o?: {
    s: string;
    S: 'BUY' | 'SELL';
    q: string;
    p: string;
    ap?: string;
    l?: string;
    z?: string;
    T?: number;
  };
}

interface LiquidationPrint {
  ts: number;
  side: 'LONG' | 'SHORT';
  notional: number;
}

const SPARK_CAP = 150; // sampled every 20s ≈ last 50 minutes
const SPARK_MS = 20_000;
const OI_SLICE_SIZE = 28;
const OI_REFRESH_MS = 10_000;
const LIQUIDATION_WINDOW_MS = 15 * 60_000;
const MAX_MARKET_SYMBOLS = 4_096;
const MARKET_EVENT_MAX_AGE_MS = 30_000;
const MAX_FUTURE_SKEW_MS = 5_000;
const SYMBOL_PATTERN = /^[A-Z0-9]{1,32}$/;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function validSymbol(value: unknown): value is string {
  return typeof value === 'string' && SYMBOL_PATTERN.test(value);
}

function validEventTime(value: unknown, now: number, maxAgeMs = MARKET_EVENT_MAX_AGE_MS): value is number {
  return (
    finite(value) && Number.isSafeInteger(value) && value >= 0 &&
    value <= now + MAX_FUTURE_SKEW_MS && now - value <= maxAgeMs
  );
}

export class MarketEngine {
  readonly feeds: Record<string, FeedStatus> = {};
  readonly filters = new Map<string, SymbolFilters>();
  /** Last spot price for EVERY USDT symbol seen on the mini-ticker feed (for valuations). */
  private spotPrices = new Map<string, number>();
  private spotChange = new Map<string, number>();
  private spotVol = new Map<string, number>();
  private spotRange = new Map<string, { high: number; low: number }>();
  private features = new Map<string, FeatureEntry>();
  private history = new Map<string, number[]>();
  private liquidations = new Map<string, LiquidationPrint[]>();
  private spotUpdatedAt = new Map<string, number>();
  private markUpdatedAt = new Map<string, number>();
  private liquidationUpdatedAt = new Map<string, number>();
  private streams: BinanceStream[] = [];
  private sampler: NodeJS.Timeout | null = null;
  private oiTimer: NodeJS.Timeout | null = null;
  private oiCursor = 0;
  private oiBusy = false;
  private running = false;
  private generation = 0;

  constructor(private readonly ledger: Ledger) {}

  get pairCount(): number {
    return this.features.size;
  }

  async init(): Promise<void> {
    const { pairs, filters } = await fetchExchangeUniverse();
    this.filters.clear();
    this.features.clear();
    let examinedFilters = 0;
    for (const [key, value] of filters) {
      if (++examinedFilters > MAX_MARKET_SYMBOLS * 2) break;
      if (this.filters.size >= MAX_MARKET_SYMBOLS) break;
      if (
        !validSymbol(key) || key !== value.symbol || !validSymbol(value.symbol) ||
        typeof value.base !== 'string' || value.base.length === 0 || value.base.length > 24 ||
        value.quote !== 'USDT' || value.status !== 'TRADING' ||
        !finite(value.stepSize) || value.stepSize < 0 ||
        !finite(value.minQty) || value.minQty < 0 ||
        !finite(value.tickSize) || value.tickSize < 0 ||
        !finite(value.minNotional) || value.minNotional < 0
      ) continue;
      this.filters.set(key, value);
    }
    for (const p of pairs.slice(0, MAX_MARKET_SYMBOLS * 2)) {
      if (this.features.size >= MAX_MARKET_SYMBOLS) break;
      const filter = this.filters.get(p.symbol);
      if (!validSymbol(p.symbol) || !filter || this.features.has(p.symbol)) continue;
      this.features.set(p.symbol, {
        symbol: p.symbol,
        base: filter.base,
        spotLast: null,
        spotOpen24h: null,
        spotHigh24h: null,
        spotLow24h: null,
        spotQuoteVol24h: null,
        perpMark: null,
        perpIndexPrice: null,
        fundingRate: null,
        nextFundingTime: null,
        openInterest: null,
        openInterestUsd: null,
        openInterestChangePct: null,
        openInterestUpdatedAt: null,
      });
    }
    this.reconcileSymbolState();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    const onStatus = (name: string, status: FeedStatus) => {
      if (!this.isActive(generation)) return;
      const prev = this.feeds[name];
      this.feeds[name] = status;
      if (prev !== status && status !== 'connecting') {
        this.safeLog(status === 'open' ? 'ws.open' : 'ws.closed', null, { feed: name });
      }
    };

    const spotStream = new BinanceStream(
      'spot-miniticker',
      'wss://stream.binance.com:9443/ws/!miniTicker@arr',
      (data) => this.onSpotMiniTickers(data, generation),
      onStatus
    );
    // NOTE: futures WS moved to tiered hosts in 2026 (/public, /market, /private).
    // Legacy wss://fstream.binance.com/ws/... opens but sends NO data since 2026-04-23.
    const markStream = new BinanceStream(
      'futures-markprice',
      'wss://fstream.binance.com/market/ws/!markPrice@arr@1s',
      (data) => this.onMarkPrices(data, generation),
      onStatus
    );
    const liquidationStream = new BinanceStream(
      'futures-liquidations',
      'wss://fstream.binance.com/market/ws/!forceOrder@arr',
      (data) => this.onForceOrders(data, generation),
      onStatus
    );

    this.streams = [spotStream, markStream, liquidationStream];
    try {
      for (const stream of this.streams) stream.start();
    } catch (error) {
      for (const stream of this.streams) stream.stop();
      this.streams = [];
      this.running = false;
      ++this.generation;
      throw error;
    }

    this.sampler = setInterval(() => {
      if (!this.isActive(generation)) return;
      for (const sym of this.filters.keys()) {
        const p = this.spotPrices.get(sym);
        if (p === undefined) continue;
        let h = this.history.get(sym);
        if (!h) {
          h = [];
          this.history.set(sym, h);
        }
        h.push(p);
        if (h.length > SPARK_CAP) h.shift();
      }
    }, SPARK_MS);

    void this.refreshOpenInterestSlice(OI_SLICE_SIZE * 2, generation).catch((error) => {
      this.safeLog('error_event', null, {
        source: 'market-engine.open-interest',
        message: error instanceof Error ? error.message : String(error),
      });
    });
    this.oiTimer = setInterval(() => {
      void this.refreshOpenInterestSlice(OI_SLICE_SIZE, generation).catch((error) => {
        this.safeLog('error_event', null, {
          source: 'market-engine.open-interest',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }, OI_REFRESH_MS);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    ++this.generation;
    for (const s of this.streams) s.stop();
    this.streams = [];
    if (this.sampler) clearInterval(this.sampler);
    if (this.oiTimer) clearInterval(this.oiTimer);
    this.sampler = null;
    this.oiTimer = null;
    this.oiBusy = false;
  }

  sparkOf(symbol: string, points = 40): number[] {
    if (!validSymbol(symbol) || !this.filters.has(symbol)) return [];
    const safePoints = Number.isSafeInteger(points) ? Math.max(2, Math.min(points, SPARK_CAP)) : 40;
    const h = this.history.get(symbol);
    if (!h || h.length < 2) return [];
    if (h.length <= safePoints) return [...h];
    const out: number[] = [];
    for (let i = 0; i < safePoints; i++) {
      out.push(h[Math.round((i / (safePoints - 1)) * (h.length - 1))]);
    }
    return out;
  }

  /** Spot price of any USDT symbol (e.g. for balance valuation). */
  priceOf(symbol: string): number | null {
    if (!this.hasFreshUpdate(this.spotUpdatedAt, symbol)) return null;
    return this.spotPrices.get(symbol) ?? null;
  }

  /** Timestamp paired with priceOf(), used to prove live order-price freshness. */
  priceUpdatedAt(symbol: string): number | null {
    if (!validSymbol(symbol) || !this.filters.has(symbol) || !this.hasFreshUpdate(this.spotUpdatedAt, symbol)) return null;
    return this.spotUpdatedAt.get(symbol) ?? null;
  }

  /** Exchange event timestamp paired with the current mark/funding values. */
  markEventTimestamp(symbol: string): number | null {
    if (!validSymbol(symbol) || !this.features.has(symbol) || !this.hasFreshUpdate(this.markUpdatedAt, symbol)) return null;
    return this.markUpdatedAt.get(symbol) ?? null;
  }

  changeOf(symbol: string): number | null {
    if (!this.hasFreshUpdate(this.spotUpdatedAt, symbol)) return null;
    return this.spotChange.get(symbol) ?? null;
  }

  private onSpotMiniTickers(data: unknown, generation: number): void {
    if (!this.isActive(generation) || !Array.isArray(data)) return;
    const now = Date.now();
    for (const raw of data.slice(0, MAX_MARKET_SYMBOLS)) {
      if (!raw || typeof raw !== 'object') continue;
      const t = raw as SpotMiniTicker;
      if (!validSymbol(t.s) || !this.filters.has(t.s) || !validEventTime(t.E, now)) continue;
      const previousTs = this.spotUpdatedAt.get(t.s);
      if (previousTs !== undefined && t.E < previousTs) continue;
      const last = Number(t.c);
      const open = Number(t.o);
      const high = Number(t.h);
      const low = Number(t.l);
      const quoteVolume = Number(t.q);
      if (
        !positive(last) || !positive(open) || !positive(high) || !positive(low) ||
        !finite(quoteVolume) || quoteVolume < 0 || low > high || last < low || last > high
      ) continue;
      this.spotUpdatedAt.set(t.s, t.E);
      this.spotPrices.set(t.s, last);
      this.spotChange.set(t.s, ((last - open) / open) * 100);
      this.spotVol.set(t.s, quoteVolume);
      this.spotRange.set(t.s, { high, low });
      const f = this.features.get(t.s);
      if (!f) continue;
      f.spotLast = last;
      f.spotOpen24h = open;
      f.spotHigh24h = high > 0 ? high : null;
      f.spotLow24h = low > 0 ? low : null;
      f.spotQuoteVol24h = quoteVolume;
    }
  }

  private onMarkPrices(data: unknown, generation: number): void {
    if (!this.isActive(generation) || !Array.isArray(data)) return;
    const now = Date.now();
    for (const raw of data.slice(0, MAX_MARKET_SYMBOLS)) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw as MarkPriceUpdate;
      if (!validSymbol(m.s) || !validEventTime(m.E, now)) continue;
      const f = this.features.get(m.s);
      if (!f) continue;
      const previousTs = this.markUpdatedAt.get(m.s);
      if (previousTs !== undefined && m.E < previousTs) continue;
      const mark = Number(m.p);
      if (!positive(mark)) continue;
      this.markUpdatedAt.set(m.s, m.E);
      f.perpMark = mark;
      const indexPrice = m.i === undefined ? Number.NaN : Number(m.i);
      f.perpIndexPrice = positive(indexPrice) ? indexPrice : null;
      const fundingRate = m.r === undefined ? Number.NaN : Number(m.r);
      f.fundingRate = finite(fundingRate) && Math.abs(fundingRate) <= 1 ? fundingRate : null;
      f.nextFundingTime = m.T !== undefined && Number.isSafeInteger(m.T) && m.T >= 0 ? m.T : null;
    }
  }

  private onForceOrders(data: unknown, generation: number): void {
    if (!this.isActive(generation)) return;
    const payload = (data && typeof data === 'object' && 'data' in data ? (data as { data: unknown }).data : data) as unknown;
    const updates = (Array.isArray(payload) ? payload : [payload]).slice(0, 1_000);
    const now = Date.now();
    for (const raw of updates) {
      if (!raw || typeof raw !== 'object') continue;
      const ev = raw as ForceOrderUpdate;
      const o = ev.o;
      if (!o || !validSymbol(o.s) || !this.features.has(o.s) || (o.S !== 'BUY' && o.S !== 'SELL')) continue;
      if (ev.st !== undefined && ev.st !== 1) continue;
      const qty = Number(o.z ?? o.l ?? o.q);
      const price = Number(o.ap ?? o.p);
      if (!(qty > 0) || !(price > 0)) continue;
      const ts = Number(o.T ?? ev.E ?? Date.now());
      if (!validEventTime(ts, now, LIQUIDATION_WINDOW_MS)) continue;
      const previousTs = this.liquidationUpdatedAt.get(o.s);
      if (previousTs !== undefined && ts < previousTs) continue;
      const notional = qty * price;
      if (!positive(notional)) continue;
      const side = o.S === 'SELL' ? 'LONG' : 'SHORT';
      const rows = this.liquidations.get(o.s) ?? [];
      rows.push({ ts, side, notional });
      this.liquidations.set(o.s, this.pruneLiquidations(rows));
      this.liquidationUpdatedAt.set(o.s, ts);
    }
  }

  private pruneLiquidations(rows: LiquidationPrint[], now = Date.now()): LiquidationPrint[] {
    const minTs = now - LIQUIDATION_WINDOW_MS;
    return rows.filter((r) => r.ts >= minTs);
  }

  private liquidationStats(symbol: string): {
    liquidations15mUsd: number | null;
    longLiquidations15mUsd: number | null;
    shortLiquidations15mUsd: number | null;
  } {
    const rows = this.pruneLiquidations(this.liquidations.get(symbol) ?? []);
    if (rows.length === 0) {
      this.liquidations.delete(symbol);
      return { liquidations15mUsd: null, longLiquidations15mUsd: null, shortLiquidations15mUsd: null };
    }
    this.liquidations.set(symbol, rows);
    let long = 0;
    let short = 0;
    for (const r of rows) {
      if (r.side === 'LONG') long += r.notional;
      else short += r.notional;
    }
    return {
      liquidations15mUsd: long + short,
      longLiquidations15mUsd: long || null,
      shortLiquidations15mUsd: short || null,
    };
  }

  private async refreshOpenInterestSlice(size = OI_SLICE_SIZE, generation = this.generation): Promise<void> {
    if (!this.isActive(generation) || this.oiBusy || this.features.size === 0) return;
    this.oiBusy = true;
    try {
      const symbols = [...this.features.keys()];
      const slice: string[] = [];
      const safeSize = Number.isSafeInteger(size) ? Math.max(1, Math.min(size, symbols.length)) : OI_SLICE_SIZE;
      for (let i = 0; i < safeSize; i++) {
        slice.push(symbols[(this.oiCursor + i) % symbols.length]);
      }
      this.oiCursor = (this.oiCursor + slice.length) % symbols.length;
      await Promise.allSettled(
        slice.map(async (symbol) => {
          const oi = await fetchOpenInterest(symbol);
          if (!this.isActive(generation) || oi.symbol !== symbol) return;
          const f = this.features.get(symbol);
          if (!f) return;
          const receivedAt = Date.now();
          const updatedAt = oi.time || receivedAt;
          if (
            !finite(oi.openInterest) || oi.openInterest < 0 ||
            !validEventTime(updatedAt, receivedAt, 2 * 60_000) ||
            (f.openInterestUpdatedAt !== null && updatedAt < f.openInterestUpdatedAt)
          ) return;
          const prevUsd = f.openInterestUsd;
          f.openInterest = oi.openInterest;
          f.openInterestUpdatedAt = updatedAt;
          const mark = this.hasFreshUpdate(this.markUpdatedAt, symbol, receivedAt)
            ? f.perpMark
            : this.hasFreshUpdate(this.spotUpdatedAt, symbol, receivedAt)
              ? f.spotLast
              : null;
          const openInterestUsd = positive(mark) ? oi.openInterest * mark : null;
          f.openInterestUsd = openInterestUsd !== null && finite(openInterestUsd) ? openInterestUsd : null;
          if (prevUsd && prevUsd > 0 && f.openInterestUsd !== null) {
            f.openInterestChangePct = ((f.openInterestUsd - prevUsd) / prevUsd) * 100;
          }
        })
      );
    } finally {
      if (this.generation === generation) this.oiBusy = false;
    }
  }

  private isActive(generation: number): boolean {
    return this.running && this.generation === generation;
  }

  private safeLog(kind: string, symbol: string | null, payload: Record<string, unknown>): void {
    try {
      this.ledger.logEvent(kind, symbol, payload);
    } catch {
      // Market data must keep flowing even when observability storage is
      // temporarily unavailable.
    }
  }

  private reconcileSymbolState(): void {
    const spotSymbols = new Set(this.filters.keys());
    const perpSymbols = new Set(this.features.keys());
    const pruneMap = <T>(map: Map<string, T>, allowed: ReadonlySet<string>) => {
      for (const symbol of map.keys()) if (!allowed.has(symbol)) map.delete(symbol);
    };
    pruneMap(this.spotPrices, spotSymbols);
    pruneMap(this.spotChange, spotSymbols);
    pruneMap(this.spotVol, spotSymbols);
    pruneMap(this.spotRange, spotSymbols);
    pruneMap(this.history, spotSymbols);
    pruneMap(this.spotUpdatedAt, spotSymbols);
    pruneMap(this.liquidations, perpSymbols);
    pruneMap(this.markUpdatedAt, perpSymbols);
    pruneMap(this.liquidationUpdatedAt, perpSymbols);
  }

  private hasFreshUpdate(updates: ReadonlyMap<string, number>, symbol: string, now = Date.now()): boolean {
    const updatedAt = updates.get(symbol);
    return updatedAt !== undefined && updatedAt <= now + MAX_FUTURE_SKEW_MS && now - updatedAt <= MARKET_EVENT_MAX_AGE_MS;
  }

  /**
   * The full tradable USDT universe: every spot+perp pair (with basis/funding)
   * PLUS spot-only symbols — "do not miss symbols". The scanner keeps using
   * rows() (pairs only); this feeds the Markets page.
   */
  allRows(): (SymbolRow & { hasSpot: boolean; hasPerp: boolean })[] {
    const out: (SymbolRow & { hasSpot: boolean; hasPerp: boolean })[] = this.rows().map((r) => ({
      ...r,
      hasSpot: true,
      hasPerp: true,
    }));
    const now = Date.now();
    for (const [sym, f] of this.filters) {
      if (this.features.has(sym)) continue;
      const spotFresh = this.hasFreshUpdate(this.spotUpdatedAt, sym, now);
      const last = spotFresh ? this.spotPrices.get(sym) : undefined;
      out.push({
        symbol: sym,
        base: f.base,
        spot: last ?? null,
        perpIndexPrice: null,
        markIndexBasisPct: null,
        perpMark: null,
        basisPct: null,
        openInterest: null,
        openInterestUsd: null,
        openInterestChangePct: null,
        openInterestUpdatedAt: null,
        liquidations15mUsd: null,
        longLiquidations15mUsd: null,
        shortLiquidations15mUsd: null,
        fundingRate: null,
        nextFundingTime: null,
        change24hPct: spotFresh ? this.spotChange.get(sym) ?? null : null,
        quoteVolume24h: spotFresh ? this.spotVol.get(sym) ?? null : null,
        high24h: spotFresh ? this.spotRange.get(sym)?.high ?? null : null,
        low24h: spotFresh ? this.spotRange.get(sym)?.low ?? null : null,
        status: 'idle',
        hasSpot: true,
        hasPerp: false,
      });
    }
    return out;
  }

  rows(): SymbolRow[] {
    const out: SymbolRow[] = [];
    const now = Date.now();
    for (const f of this.features.values()) {
      const spotFresh = this.hasFreshUpdate(this.spotUpdatedAt, f.symbol, now);
      const markFresh = this.hasFreshUpdate(this.markUpdatedAt, f.symbol, now);
      const spotLast = spotFresh ? f.spotLast : null;
      const spotOpen = spotFresh ? f.spotOpen24h : null;
      const perpMark = markFresh ? f.perpMark : null;
      const perpIndexPrice = markFresh ? f.perpIndexPrice : null;
      const liq = this.liquidationStats(f.symbol);
      out.push({
        symbol: f.symbol,
        base: f.base,
        spot: spotLast,
        perpMark,
        perpIndexPrice,
        markIndexBasisPct:
          perpMark !== null && perpIndexPrice !== null && perpIndexPrice > 0
            ? ((perpMark - perpIndexPrice) / perpIndexPrice) * 100
            : null,
        basisPct:
          spotLast !== null && perpMark !== null && spotLast > 0
            ? ((perpMark - spotLast) / spotLast) * 100
            : null,
        openInterest: f.openInterest,
        openInterestUsd: f.openInterestUsd,
        openInterestChangePct: f.openInterestChangePct,
        openInterestUpdatedAt: f.openInterestUpdatedAt,
        liquidations15mUsd: liq.liquidations15mUsd,
        longLiquidations15mUsd: liq.longLiquidations15mUsd,
        shortLiquidations15mUsd: liq.shortLiquidations15mUsd,
        fundingRate: markFresh ? f.fundingRate : null,
        nextFundingTime: markFresh ? f.nextFundingTime : null,
        change24hPct:
          spotLast !== null && spotOpen !== null && spotOpen > 0
            ? ((spotLast - spotOpen) / spotOpen) * 100
            : null,
        quoteVolume24h: spotFresh ? f.spotQuoteVol24h : null,
        high24h: spotFresh ? f.spotHigh24h : null,
        low24h: spotFresh ? f.spotLow24h : null,
        status: 'idle',
      });
    }
    return out;
  }
}
