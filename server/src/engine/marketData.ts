import { BinanceStream, type FeedStatus } from '../binance/ws.js';
import { fetchPairedSymbols } from '../binance/rest.js';
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
  priceHistory: number[];
  basisHistory: number[];
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

const HISTORY_CAP = 120; // sampled every 30s → 1 hour of history
const SAMPLE_MS = 30_000;

export class MarketEngine {
  readonly feeds: Record<string, FeedStatus> = {};
  private features = new Map<string, FeatureEntry>();
  private streams: BinanceStream[] = [];
  private sampler: NodeJS.Timeout | null = null;

  constructor(private readonly ledger: Ledger) {}

  get pairCount(): number {
    return this.features.size;
  }

  async init(): Promise<void> {
    const pairs = await fetchPairedSymbols();
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
        priceHistory: [],
        basisHistory: [],
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

    this.sampler = setInterval(() => this.sampleHistory(), SAMPLE_MS);
  }

  stop(): void {
    for (const s of this.streams) s.stop();
    if (this.sampler) clearInterval(this.sampler);
  }

  private onSpotMiniTickers(data: unknown): void {
    if (!Array.isArray(data)) return;
    for (const t of data as SpotMiniTicker[]) {
      const f = this.features.get(t.s);
      if (!f) continue;
      f.spotLast = Number(t.c);
      f.spotOpen24h = Number(t.o);
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

  private sampleHistory(): void {
    for (const f of this.features.values()) {
      if (f.spotLast !== null) {
        f.priceHistory.push(f.spotLast);
        if (f.priceHistory.length > HISTORY_CAP) f.priceHistory.shift();
      }
      const basis = basisPct(f);
      if (basis !== null) {
        f.basisHistory.push(basis);
        if (f.basisHistory.length > HISTORY_CAP) f.basisHistory.shift();
      }
    }
  }

  sparkOf(symbol: string): { price: number[]; basis: number[] } {
    const f = this.features.get(symbol);
    return {
      price: f ? [...f.priceHistory] : [],
      basis: f ? [...f.basisHistory] : [],
    };
  }

  rows(): SymbolRow[] {
    const out: SymbolRow[] = [];
    for (const f of this.features.values()) {
      out.push({
        symbol: f.symbol,
        base: f.base,
        spot: f.spotLast,
        perpMark: f.perpMark,
        basisPct: basisPct(f),
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
    out.sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0));
    return out;
  }
}

function basisPct(f: FeatureEntry): number | null {
  if (f.spotLast === null || f.perpMark === null || f.spotLast <= 0) return null;
  return ((f.perpMark - f.spotLast) / f.spotLast) * 100;
}
