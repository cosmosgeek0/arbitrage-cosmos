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
  s: string;
  c: string;
  o: string;
  h: string;
  l: string;
  q: string;
}

interface MarkPriceUpdate {
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
  private streams: BinanceStream[] = [];
  private sampler: NodeJS.Timeout | null = null;
  private oiTimer: NodeJS.Timeout | null = null;
  private oiCursor = 0;
  private oiBusy = false;

  constructor(private readonly ledger: Ledger) {}

  get pairCount(): number {
    return this.features.size;
  }

  async init(): Promise<void> {
    const { pairs, filters } = await fetchExchangeUniverse();
    for (const [k, v] of filters) this.filters.set(k, v);
    for (const p of pairs) {
      this.features.set(p.symbol, {
        symbol: p.symbol,
        base: p.base,
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
  }

  start(): void {
    const onStatus = (name: string, status: FeedStatus) => {
      const prev = this.feeds[name];
      this.feeds[name] = status;
      if (prev !== status && status !== 'connecting') {
        this.ledger.logEvent(status === 'open' ? 'ws.open' : 'ws.closed', null, { feed: name });
      }
    };

    const spotStream = new BinanceStream(
      'spot-miniticker',
      'wss://stream.binance.com:9443/ws/!miniTicker@arr',
      (data) => this.onSpotMiniTickers(data),
      onStatus
    );
    // NOTE: futures WS moved to tiered hosts in 2026 (/public, /market, /private).
    // Legacy wss://fstream.binance.com/ws/... opens but sends NO data since 2026-04-23.
    const markStream = new BinanceStream(
      'futures-markprice',
      'wss://fstream.binance.com/market/ws/!markPrice@arr@1s',
      (data) => this.onMarkPrices(data),
      onStatus
    );
    const liquidationStream = new BinanceStream(
      'futures-liquidations',
      'wss://fstream.binance.com/market/ws/!forceOrder@arr',
      (data) => this.onForceOrders(data),
      onStatus
    );

    this.streams = [spotStream, markStream, liquidationStream];
    for (const s of this.streams) s.start();

    this.sampler = setInterval(() => {
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

    void this.refreshOpenInterestSlice(OI_SLICE_SIZE * 2);
    this.oiTimer = setInterval(() => void this.refreshOpenInterestSlice(), OI_REFRESH_MS);
  }

  stop(): void {
    for (const s of this.streams) s.stop();
    if (this.sampler) clearInterval(this.sampler);
    if (this.oiTimer) clearInterval(this.oiTimer);
  }

  sparkOf(symbol: string, points = 40): number[] {
    const h = this.history.get(symbol);
    if (!h || h.length < 2) return [];
    if (h.length <= points) return [...h];
    const out: number[] = [];
    for (let i = 0; i < points; i++) {
      out.push(h[Math.round((i / (points - 1)) * (h.length - 1))]);
    }
    return out;
  }

  /** Spot price of any USDT symbol (e.g. for balance valuation). */
  priceOf(symbol: string): number | null {
    return this.spotPrices.get(symbol) ?? null;
  }

  changeOf(symbol: string): number | null {
    return this.spotChange.get(symbol) ?? null;
  }

  private onSpotMiniTickers(data: unknown): void {
    if (!Array.isArray(data)) return;
    for (const t of data as SpotMiniTicker[]) {
      const last = Number(t.c);
      const open = Number(t.o);
      const high = Number(t.h);
      const low = Number(t.l);
      if (t.s.endsWith('USDT')) {
        this.spotPrices.set(t.s, last);
        if (open > 0) this.spotChange.set(t.s, ((last - open) / open) * 100);
        this.spotVol.set(t.s, Number(t.q));
        if (high > 0 && low > 0) this.spotRange.set(t.s, { high, low });
      }
      const f = this.features.get(t.s);
      if (!f) continue;
      f.spotLast = last;
      f.spotOpen24h = open;
      f.spotHigh24h = high > 0 ? high : null;
      f.spotLow24h = low > 0 ? low : null;
      f.spotQuoteVol24h = Number(t.q);
    }
  }

  private onMarkPrices(data: unknown): void {
    if (!Array.isArray(data)) return;
    for (const m of data as MarkPriceUpdate[]) {
      const f = this.features.get(m.s);
      if (!f) continue;
      f.perpMark = Number(m.p);
      if (m.i !== undefined) f.perpIndexPrice = Number(m.i);
      if (m.r !== undefined) f.fundingRate = Number(m.r);
      if (m.T !== undefined) f.nextFundingTime = m.T;
    }
  }

  private onForceOrders(data: unknown): void {
    const payload = (data && typeof data === 'object' && 'data' in data ? (data as { data: unknown }).data : data) as unknown;
    const updates = Array.isArray(payload) ? payload : [payload];
    for (const raw of updates) {
      const ev = raw as ForceOrderUpdate;
      const o = ev.o;
      if (!o?.s || !this.features.has(o.s)) continue;
      if (ev.st !== undefined && ev.st !== 1) continue;
      const qty = Number(o.z ?? o.l ?? o.q);
      const price = Number(o.ap ?? o.p);
      if (!(qty > 0) || !(price > 0)) continue;
      const ts = Number(o.T ?? ev.E ?? Date.now());
      const notional = qty * price;
      const side = o.S === 'SELL' ? 'LONG' : 'SHORT';
      const rows = this.liquidations.get(o.s) ?? [];
      rows.push({ ts, side, notional });
      this.liquidations.set(o.s, this.pruneLiquidations(rows));
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
    if (rows.length === 0) return { liquidations15mUsd: null, longLiquidations15mUsd: null, shortLiquidations15mUsd: null };
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

  private async refreshOpenInterestSlice(size = OI_SLICE_SIZE): Promise<void> {
    if (this.oiBusy || this.features.size === 0) return;
    this.oiBusy = true;
    try {
      const symbols = [...this.features.keys()];
      const slice: string[] = [];
      for (let i = 0; i < Math.min(size, symbols.length); i++) {
        slice.push(symbols[(this.oiCursor + i) % symbols.length]);
      }
      this.oiCursor = (this.oiCursor + slice.length) % symbols.length;
      await Promise.allSettled(
        slice.map(async (symbol) => {
          const oi = await fetchOpenInterest(symbol);
          const f = this.features.get(symbol);
          if (!f) return;
          const prevUsd = f.openInterestUsd;
          f.openInterest = oi.openInterest;
          f.openInterestUpdatedAt = oi.time || Date.now();
          const mark = f.perpMark ?? f.spotLast;
          f.openInterestUsd = mark && mark > 0 ? oi.openInterest * mark : null;
          if (prevUsd && prevUsd > 0 && f.openInterestUsd !== null) {
            f.openInterestChangePct = ((f.openInterestUsd - prevUsd) / prevUsd) * 100;
          }
        })
      );
    } finally {
      this.oiBusy = false;
    }
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
    for (const [sym, f] of this.filters) {
      if (this.features.has(sym)) continue;
      const last = this.spotPrices.get(sym);
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
        change24hPct: this.spotChange.get(sym) ?? null,
        quoteVolume24h: this.spotVol.get(sym) ?? null,
        high24h: this.spotRange.get(sym)?.high ?? null,
        low24h: this.spotRange.get(sym)?.low ?? null,
        status: 'idle',
        hasSpot: true,
        hasPerp: false,
      });
    }
    return out;
  }

  rows(): SymbolRow[] {
    const out: SymbolRow[] = [];
    for (const f of this.features.values()) {
      const liq = this.liquidationStats(f.symbol);
      out.push({
        symbol: f.symbol,
        base: f.base,
        spot: f.spotLast,
        perpMark: f.perpMark,
        perpIndexPrice: f.perpIndexPrice,
        markIndexBasisPct:
          f.perpMark !== null && f.perpIndexPrice !== null && f.perpIndexPrice > 0
            ? ((f.perpMark - f.perpIndexPrice) / f.perpIndexPrice) * 100
            : null,
        basisPct:
          f.spotLast !== null && f.perpMark !== null && f.spotLast > 0
            ? ((f.perpMark - f.spotLast) / f.spotLast) * 100
            : null,
        openInterest: f.openInterest,
        openInterestUsd: f.openInterestUsd,
        openInterestChangePct: f.openInterestChangePct,
        openInterestUpdatedAt: f.openInterestUpdatedAt,
        liquidations15mUsd: liq.liquidations15mUsd,
        longLiquidations15mUsd: liq.longLiquidations15mUsd,
        shortLiquidations15mUsd: liq.shortLiquidations15mUsd,
        fundingRate: f.fundingRate,
        nextFundingTime: f.nextFundingTime,
        change24hPct:
          f.spotLast !== null && f.spotOpen24h !== null && f.spotOpen24h > 0
            ? ((f.spotLast - f.spotOpen24h) / f.spotOpen24h) * 100
            : null,
        quoteVolume24h: f.spotQuoteVol24h,
        high24h: f.spotHigh24h,
        low24h: f.spotLow24h,
        status: 'idle',
      });
    }
    return out;
  }
}
