/**
 * Rolling window engine tailored to wakeup detection.
 * Two rings per symbol: 60 × 1s fine buckets (1s/5s/15s/60s windows) and
 * N × 1m coarse buckets (5m/1h windows + baseline history). Memory-bounded,
 * no DB queries per tick (ENGINE.md §7), plus a short raw-trade window for
 * tape forensics (§9 focus checks: "keep raw event window briefly").
 */
import type { TradeTick, WindowKey, WindowStats } from '../v0/types.js';
import type { RawTrade } from './types.js';
import type { VolumeConfig } from './config.js';

interface Bucket {
  startMs: number; // bucket epoch start; -1 = empty slot
  quoteVolume: number;
  tradeCount: number;
  takerBuyQuote: number;
  largeTradeCount: number;
  maxTradeQuote: number;
  open: number;
  close: number;
  high: number;
  low: number;
}

export interface SeedMinute {
  startMs: number;
  quoteVolume: number;
  tradeCount: number;
  takerBuyQuote: number;
  open: number;
  close: number;
  high: number;
  low: number;
}

function emptyBucket(): Bucket {
  return {
    startMs: -1,
    quoteVolume: 0,
    tradeCount: 0,
    takerBuyQuote: 0,
    largeTradeCount: 0,
    maxTradeQuote: 0,
    open: 0,
    close: 0,
    high: 0,
    low: 0,
  };
}

function resetBucket(b: Bucket, startMs: number): void {
  b.startMs = startMs;
  b.quoteVolume = 0;
  b.tradeCount = 0;
  b.takerBuyQuote = 0;
  b.largeTradeCount = 0;
  b.maxTradeQuote = 0;
  b.open = 0;
  b.close = 0;
  b.high = 0;
  b.low = 0;
}

class BucketRing {
  private slots: Bucket[];
  constructor(
    private size: number,
    private widthMs: number,
  ) {
    this.slots = Array.from({ length: size }, emptyBucket);
  }

  private slotFor(ts: number): Bucket {
    const startMs = Math.floor(ts / this.widthMs) * this.widthMs;
    const idx = Math.floor(startMs / this.widthMs) % this.size;
    const b = this.slots[idx];
    if (b.startMs !== startMs) resetBucket(b, startMs);
    return b;
  }

  add(t: TradeTick, largeTradeQuoteUsd: number): void {
    const b = this.slotFor(t.ts);
    if (b.tradeCount === 0) {
      b.open = t.price;
      b.high = t.price;
      b.low = t.price;
    } else {
      if (t.price > b.high) b.high = t.price;
      if (t.price < b.low) b.low = t.price;
    }
    b.close = t.price;
    b.quoteVolume += t.quoteQty;
    b.tradeCount += 1;
    if (!t.isBuyerMaker) b.takerBuyQuote += t.quoteQty;
    if (t.quoteQty >= largeTradeQuoteUsd) b.largeTradeCount += 1;
    if (t.quoteQty > b.maxTradeQuote) b.maxTradeQuote = t.quoteQty;
  }

  seedMinute(sample: SeedMinute): void {
    const bucket = this.slotFor(sample.startMs);
    bucket.quoteVolume = Math.max(0, sample.quoteVolume);
    bucket.tradeCount = Math.max(0, Math.round(sample.tradeCount));
    bucket.takerBuyQuote = Math.max(0, Math.min(bucket.quoteVolume, sample.takerBuyQuote));
    bucket.largeTradeCount = 0;
    bucket.maxTradeQuote = bucket.tradeCount > 0 ? bucket.quoteVolume / bucket.tradeCount : 0;
    bucket.open = sample.open;
    bucket.close = sample.close;
    bucket.high = sample.high;
    bucket.low = sample.low;
  }

  /**
   * Last `count` buckets ending at the bucket containing `nowTs`
   * (inclusive unless excludeCurrent). Empty periods yield null entries.
   */
  recent(nowTs: number, count: number, excludeCurrent = false): (Bucket | null)[] {
    const endStart =
      Math.floor(nowTs / this.widthMs) * this.widthMs - (excludeCurrent ? this.widthMs : 0);
    const out: (Bucket | null)[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const startMs = endStart - i * this.widthMs;
      if (startMs < 0) {
        out.push(null);
        continue;
      }
      const idx = Math.floor(startMs / this.widthMs) % this.size;
      const b = this.slots[idx];
      out.push(b.startMs === startMs ? b : null);
    }
    return out;
  }
}

export interface WindowExtras extends WindowStats {
  maxTradeQuote: number;
  realizedVolPct: number | null; // stdev of bucket-close log returns, pct
}

const WINDOW_SPEC: Record<WindowKey, { ring: 'fine' | 'coarse'; buckets: number }> = {
  '1s': { ring: 'fine', buckets: 1 },
  '5s': { ring: 'fine', buckets: 5 },
  '15s': { ring: 'fine', buckets: 15 },
  '60s': { ring: 'fine', buckets: 60 },
  '5m': { ring: 'coarse', buckets: 5 },
  '1h': { ring: 'coarse', buckets: 60 },
};

/** Per-symbol rolling state. */
export class RollingTape {
  private fine: BucketRing;
  private coarse: BucketRing;
  private raw: RawTrade[] = [];
  firstSeenTs: number;
  lastTradeTs: number | null = null;
  lastPrice: number | null = null;

  constructor(
    private cfg: VolumeConfig,
    firstSeenTs: number,
  ) {
    this.firstSeenTs = firstSeenTs;
    this.fine = new BucketRing(60, 1_000);
    this.coarse = new BucketRing(Math.max(cfg.baselineWindowMinutes, 60) + 2, 60_000);
  }

  addTrade(t: TradeTick, printCount = 1): void {
    this.fine.add(t, this.cfg.largeTradeQuoteUsd);
    this.coarse.add(t, this.cfg.largeTradeQuoteUsd);
    this.lastTradeTs = t.ts;
    this.lastPrice = t.price;
    this.raw.push({
      price: t.price,
      qty: t.qty,
      quoteQty: t.quoteQty,
      isBuyerMaker: t.isBuyerMaker,
      ts: t.ts,
      printCount,
    });
    // bound the raw window by time and count
    const cutoff = t.ts - this.cfg.rawTradeWindowMs;
    let drop = 0;
    while (drop < this.raw.length && this.raw[drop].ts < cutoff) drop++;
    if (drop > 0) this.raw.splice(0, drop);
    if (this.raw.length > this.cfg.maxRawTrades)
      this.raw.splice(0, this.raw.length - this.cfg.maxRawTrades);
  }

  /** Seed a completed Binance 1m candle into the coarse history only. */
  seedMinute(sample: SeedMinute): void {
    this.firstSeenTs = Math.min(this.firstSeenTs, sample.startMs);
    this.coarse.seedMinute(sample);
  }

  rawWindow(nowTs: number, windowMs: number): RawTrade[] {
    const cutoff = nowTs - windowMs;
    return this.raw.filter((t) => t.ts >= cutoff);
  }

  window(key: WindowKey, nowTs: number): WindowExtras {
    const spec = WINDOW_SPEC[key];
    const buckets = (spec.ring === 'fine' ? this.fine : this.coarse).recent(nowTs, spec.buckets);
    let quoteVolume = 0;
    let tradeCount = 0;
    let takerBuyQuote = 0;
    let largeTradeCount = 0;
    let maxTradeQuote = 0;
    let open: number | null = null;
    let close: number | null = null;
    const closes: number[] = [];
    for (const b of buckets) {
      if (!b || b.tradeCount === 0) continue;
      quoteVolume += b.quoteVolume;
      tradeCount += b.tradeCount;
      takerBuyQuote += b.takerBuyQuote;
      largeTradeCount += b.largeTradeCount;
      if (b.maxTradeQuote > maxTradeQuote) maxTradeQuote = b.maxTradeQuote;
      if (open === null) open = b.open;
      close = b.close;
      closes.push(b.close);
    }
    let realizedVolPct: number | null = null;
    if (closes.length >= 3) {
      const rets: number[] = [];
      for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
      const mean = rets.reduce((a, r) => a + r, 0) / rets.length;
      const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
      realizedVolPct = Math.sqrt(variance) * 100;
    }
    return {
      quoteVolume,
      tradeCount,
      avgTradeSize: tradeCount > 0 ? quoteVolume / tradeCount : 0,
      priceMovePct: open !== null && close !== null && open > 0 ? ((close - open) / open) * 100 : 0,
      takerBuyRatio: quoteVolume > 0 ? takerBuyQuote / quoteVolume : null,
      largeTradeCount,
      maxTradeQuote,
      realizedVolPct,
    };
  }

  /**
   * Completed per-minute samples for baseline building. Minutes inside the
   * observation span with no trades count as genuine zero-volume samples —
   * that IS the dead symbol's norm.
   */
  minuteHistory(nowTs: number): { quoteVolume: number; tradeCount: number }[] {
    const observedMinutes = Math.floor((nowTs - this.firstSeenTs) / 60_000);
    const n = Math.min(observedMinutes, this.cfg.baselineWindowMinutes);
    if (n <= 0) return [];
    const buckets = this.coarse.recent(nowTs, n, true);
    return buckets.map((b) =>
      b ? { quoteVolume: b.quoteVolume, tradeCount: b.tradeCount } : { quoteVolume: 0, tradeCount: 0 },
    );
  }
}
