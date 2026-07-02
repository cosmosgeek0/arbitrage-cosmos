import { BinanceStream, type FeedStatus } from '../binance/ws.js';
import { fetchExchangeUniverse, type SymbolFilters } from '../binance/rest.js';
import type { Ledger } from '../ledger.js';
import type { SymbolRow } from '../types.js';

interface FeatureEntry {
  symbol: string;
  base: string;
  spotLast: number | null;
  spotOpen24h: number | null;
  spotQuoteVol24h: number | null;
  perpMark: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
}

interface SpotMiniTicker {
  s: string;
  c: string;
  o: string;
  q: string;
}

interface MarkPriceUpdate {
  s: string;
  p: string;
  r?: string;
  T?: number;
}

export class MarketEngine {
  readonly feeds: Record<string, FeedStatus> = {};
  readonly filters = new Map<string, SymbolFilters>();
  /** Last spot price for EVERY USDT symbol seen on the mini-ticker feed (for valuations). */
  private spotPrices = new Map<string, number>();
  private spotChange = new Map<string, number>();
  private features = new Map<string, FeatureEntry>();
  private streams: BinanceStream[] = [];

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
        spotQuoteVol24h: null,
        perpMark: null,
        fundingRate: null,
        nextFundingTime: null,
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

    this.streams = [spotStream, markStream];
    for (const s of this.streams) s.start();
  }

  stop(): void {
    for (const s of this.streams) s.stop();
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
      if (t.s.endsWith('USDT')) {
        this.spotPrices.set(t.s, last);
        if (open > 0) this.spotChange.set(t.s, ((last - open) / open) * 100);
      }
      const f = this.features.get(t.s);
      if (!f) continue;
      f.spotLast = last;
      f.spotOpen24h = open;
      f.spotQuoteVol24h = Number(t.q);
    }
  }

  private onMarkPrices(data: unknown): void {
    if (!Array.isArray(data)) return;
    for (const m of data as MarkPriceUpdate[]) {
      const f = this.features.get(m.s);
      if (!f) continue;
      f.perpMark = Number(m.p);
      if (m.r !== undefined) f.fundingRate = Number(m.r);
      if (m.T !== undefined) f.nextFundingTime = m.T;
    }
  }

  rows(): SymbolRow[] {
    const out: SymbolRow[] = [];
    for (const f of this.features.values()) {
      out.push({
        symbol: f.symbol,
        base: f.base,
        spot: f.spotLast,
        perpMark: f.perpMark,
        basisPct:
          f.spotLast !== null && f.perpMark !== null && f.spotLast > 0
            ? ((f.perpMark - f.spotLast) / f.spotLast) * 100
            : null,
        fundingRate: f.fundingRate,
        nextFundingTime: f.nextFundingTime,
        change24hPct:
          f.spotLast !== null && f.spotOpen24h !== null && f.spotOpen24h > 0
            ? ((f.spotLast - f.spotOpen24h) / f.spotOpen24h) * 100
            : null,
        quoteVolume24h: f.spotQuoteVol24h,
        status: 'idle',
      });
    }
    return out;
  }
}
