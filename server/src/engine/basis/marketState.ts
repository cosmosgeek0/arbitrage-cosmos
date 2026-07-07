/**
 * Basis engine — own market state store (deliberately independent of the
 * legacy engine/marketData.ts feed; duplication beats collision per the lane
 * contract). Holds the latest spot book, perp book, mark/funding, optional
 * depth ladders, borrow info and funding history per symbol, and answers
 * staleness/skew questions against an injected Clock.
 */
import type { BookTicker, Clock, MarkFunding, SymbolMeta } from '../v0/types.js';
import type { BorrowInfo, DepthLadder, FundingHistoryPoint } from './types.js';

interface SymbolBucket {
  meta: SymbolMeta | null;
  spotBook: BookTicker | null;
  spotSeenTs: number | null; // local receive time (spot bookTicker has no event time)
  perpBook: BookTicker | null;
  perpSeenTs: number | null;
  markFunding: MarkFunding | null;
  markSeenTs: number | null;
  spotDepth: DepthLadder | null;
  perpDepth: DepthLadder | null;
  fundingHistory: FundingHistoryPoint[];
}

const FUNDING_HISTORY_KEEP = 32;

export class BasisMarketState {
  private buckets = new Map<string, SymbolBucket>();
  private borrowByAsset = new Map<string, BorrowInfo>();

  constructor(private clock: Clock) {}

  private bucket(symbol: string): SymbolBucket {
    let b = this.buckets.get(symbol);
    if (!b) {
      b = {
        meta: null,
        spotBook: null,
        spotSeenTs: null,
        perpBook: null,
        perpSeenTs: null,
        markFunding: null,
        markSeenTs: null,
        spotDepth: null,
        perpDepth: null,
        fundingHistory: [],
      };
      this.buckets.set(symbol, b);
    }
    return b;
  }

  // ---------- ingest (the exact API future live adapters will call) ----------

  setUniverse(symbols: SymbolMeta[]): void {
    for (const meta of symbols) this.bucket(meta.symbol).meta = meta;
  }

  onSpotBook(tick: BookTicker): void {
    const b = this.bucket(tick.symbol);
    b.spotBook = tick;
    b.spotSeenTs = this.clock.now();
  }

  onPerpBook(tick: BookTicker): void {
    const b = this.bucket(tick.symbol);
    b.perpBook = tick;
    b.perpSeenTs = this.clock.now();
  }

  onMarkFunding(tick: MarkFunding): void {
    const b = this.bucket(tick.symbol);
    b.markFunding = tick;
    b.markSeenTs = this.clock.now();
    // fold live funding observations into the flip-risk history
    const h = b.fundingHistory;
    if (h.length === 0 || h[h.length - 1].fundingRate !== tick.fundingRate) {
      h.push({ fundingRate: tick.fundingRate, ts: tick.ts });
      if (h.length > FUNDING_HISTORY_KEEP) h.splice(0, h.length - FUNDING_HISTORY_KEEP);
    }
  }

  onSpotDepth(ladder: DepthLadder): void {
    this.bucket(ladder.symbol).spotDepth = ladder;
  }

  onPerpDepth(ladder: DepthLadder): void {
    this.bucket(ladder.symbol).perpDepth = ladder;
  }

  onBorrowInfo(info: BorrowInfo): void {
    this.borrowByAsset.set(info.asset, info);
  }

  seedFundingHistory(symbol: string, points: FundingHistoryPoint[]): void {
    const b = this.bucket(symbol);
    b.fundingHistory = points.slice(-FUNDING_HISTORY_KEEP);
  }

  // ---------- reads ----------

  symbols(): string[] {
    return [...this.buckets.keys()];
  }

  meta(symbol: string): SymbolMeta | null {
    return this.buckets.get(symbol)?.meta ?? null;
  }

  universe(): SymbolMeta[] {
    const out: SymbolMeta[] = [];
    for (const b of this.buckets.values()) if (b.meta) out.push(b.meta);
    return out;
  }

  spotBook(symbol: string): BookTicker | null {
    return this.buckets.get(symbol)?.spotBook ?? null;
  }

  perpBook(symbol: string): BookTicker | null {
    return this.buckets.get(symbol)?.perpBook ?? null;
  }

  markFunding(symbol: string): MarkFunding | null {
    return this.buckets.get(symbol)?.markFunding ?? null;
  }

  spotDepth(symbol: string): DepthLadder | null {
    return this.buckets.get(symbol)?.spotDepth ?? null;
  }

  perpDepth(symbol: string): DepthLadder | null {
    return this.buckets.get(symbol)?.perpDepth ?? null;
  }

  fundingHistory(symbol: string): FundingHistoryPoint[] {
    return this.buckets.get(symbol)?.fundingHistory ?? [];
  }

  /** Borrow info for the symbol's BASE asset (what reverse basis must borrow). */
  borrowForSymbol(symbol: string): BorrowInfo | null {
    const meta = this.meta(symbol);
    if (!meta) return null;
    return this.borrowByAsset.get(meta.base) ?? null;
  }

  // ---------- staleness / skew ----------

  /** Spot staleness: local receive age (spot bookTicker carries no event time). */
  spotStalenessMs(symbol: string): number | null {
    const seen = this.buckets.get(symbol)?.spotSeenTs ?? null;
    return seen === null ? null : this.clock.now() - seen;
  }

  /** Perp staleness: prefer exchange event time, fall back to receive time. */
  perpStalenessMs(symbol: string): number | null {
    const b = this.buckets.get(symbol);
    if (!b) return null;
    const ref = b.perpBook?.ts ?? b.perpSeenTs;
    return ref === null || ref === undefined ? null : this.clock.now() - ref;
  }

  markStalenessMs(symbol: string): number | null {
    const seen = this.buckets.get(symbol)?.markSeenTs ?? null;
    return seen === null ? null : this.clock.now() - seen;
  }

  /** |spot book ts − perp book ts| — cross-leg observation skew. */
  legSkewMs(symbol: string): number | null {
    const b = this.buckets.get(symbol);
    if (!b?.spotBook || !b.perpBook) return null;
    const spotTs = b.spotBook.ts || b.spotSeenTs;
    const perpTs = b.perpBook.ts || b.perpSeenTs;
    if (spotTs === null || perpTs === null || spotTs === undefined || perpTs === undefined) return null;
    return Math.abs(spotTs - perpTs);
  }
}
