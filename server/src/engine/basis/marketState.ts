/**
 * Basis engine market state. This is the trust boundary for all market and
 * borrow observations: unknown symbols, malformed numbers, crossed books,
 * stale/future timestamps, and out-of-order updates never enter live state.
 */
import type { BookTicker, Clock, MarkFunding, SymbolMeta } from '../v0/types.js';
import { basisConfig, type BasisConfig } from './config.js';
import type { BorrowInfo, DepthLadder, FundingHistoryPoint, LadderLevel } from './types.js';

interface SymbolBucket {
  meta: SymbolMeta;
  spotBook: BookTicker | null;
  spotSeenTs: number | null;
  perpBook: BookTicker | null;
  perpSeenTs: number | null;
  markFunding: MarkFunding | null;
  markSeenTs: number | null;
  spotDepth: DepthLadder | null;
  perpDepth: DepthLadder | null;
  fundingHistory: FundingHistoryPoint[];
}

const SYMBOL_RE = /^[A-Z0-9]{2,32}$/;
const ASSET_RE = /^[A-Z0-9]{1,16}$/;
const MAX_MARKET_NUMBER = 1e15;
const MAX_ABS_FUNDING_RATE = 0.1;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function finitePositive(value: unknown): value is number {
  return finite(value) && value > 0 && value <= MAX_MARKET_NUMBER;
}

function optionalPositive(value: unknown): value is number | null {
  return value === null || finitePositive(value);
}

function validMeta(meta: SymbolMeta): boolean {
  return Boolean(
    meta &&
      typeof meta === 'object' &&
      SYMBOL_RE.test(meta.symbol) &&
      ASSET_RE.test(meta.base) &&
      ASSET_RE.test(meta.quote) &&
      meta.quote === 'USDT' &&
      meta.symbol === `${meta.base}${meta.quote}` &&
      typeof meta.hasSpot === 'boolean' &&
      typeof meta.hasPerp === 'boolean' &&
      (!meta.eligible || (meta.hasSpot && meta.hasPerp)) &&
      (meta.marginBorrowable === null || typeof meta.marginBorrowable === 'boolean') &&
      optionalPositive(meta.minNotionalUsd) &&
      optionalPositive(meta.tickSize) &&
      optionalPositive(meta.stepSize) &&
      (meta.quoteVolume24hUsd === null || (finite(meta.quoteVolume24hUsd) && meta.quoteVolume24hUsd >= 0 && meta.quoteVolume24hUsd <= MAX_MARKET_NUMBER)) &&
      typeof meta.eligible === 'boolean' &&
      (meta.ineligibleReason === null || typeof meta.ineligibleReason === 'string'),
  );
}

function cloneMeta(meta: SymbolMeta): SymbolMeta {
  return { ...meta };
}

function emptyBucket(meta: SymbolMeta): SymbolBucket {
  return {
    meta: cloneMeta(meta),
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
}

export class BasisMarketState {
  private buckets = new Map<string, SymbolBucket>();
  private borrowByAsset = new Map<string, BorrowInfo>();

  constructor(
    private clock: Clock,
    private cfg: BasisConfig = basisConfig(),
  ) {}

  /** Replace, rather than append to, the known universe. */
  setUniverse(symbols: SymbolMeta[]): void {
    if (!Array.isArray(symbols) || symbols.length > this.cfg.maxUniverseSize) {
      throw new RangeError(`basis universe exceeds ${this.cfg.maxUniverseSize} symbols`);
    }

    const next = new Map<string, SymbolBucket>();
    for (const meta of symbols) {
      if (!validMeta(meta) || next.has(meta.symbol)) continue;
      const current = this.buckets.get(meta.symbol);
      if (current && current.meta.base === meta.base && current.meta.quote === meta.quote) {
        current.meta = cloneMeta(meta);
        next.set(meta.symbol, current);
      } else {
        next.set(meta.symbol, emptyBucket(meta));
      }
    }
    this.buckets = next;

    const bases = new Set([...next.values()].map((bucket) => bucket.meta.base));
    for (const asset of this.borrowByAsset.keys()) {
      if (!bases.has(asset)) this.borrowByAsset.delete(asset);
    }
  }

  reconcileConfigBounds(): void {
    if (this.buckets.size > this.cfg.maxUniverseSize) {
      throw new RangeError(`current basis universe exceeds revised limit ${this.cfg.maxUniverseSize}`);
    }
    for (const bucket of this.buckets.values()) {
      this.trimFundingHistory(bucket.fundingHistory);
      if (
        (bucket.spotDepth && (bucket.spotDepth.bids.length > this.cfg.maxDepthLevels || bucket.spotDepth.asks.length > this.cfg.maxDepthLevels)) ||
        (bucket.perpDepth && (bucket.perpDepth.bids.length > this.cfg.maxDepthLevels || bucket.perpDepth.asks.length > this.cfg.maxDepthLevels))
      ) {
        bucket.spotDepth = null;
        bucket.perpDepth = null;
      }
    }
  }

  onSpotBook(tick: BookTicker): void {
    const bucket = this.buckets.get(tick.symbol);
    if (!bucket || this.outOfOrder(tick.ts, bucket.spotBook?.ts)) return;
    if (!this.freshTimestamp(tick.ts, this.cfg.staleMs) || !this.validBook(tick)) {
      bucket.spotBook = null;
      bucket.spotSeenTs = null;
      return;
    }
    bucket.spotBook = { ...tick };
    bucket.spotSeenTs = this.clock.now();
  }

  onPerpBook(tick: BookTicker): void {
    const bucket = this.buckets.get(tick.symbol);
    if (!bucket || this.outOfOrder(tick.ts, bucket.perpBook?.ts)) return;
    if (!this.freshTimestamp(tick.ts, this.cfg.staleMs) || !this.validBook(tick)) {
      bucket.perpBook = null;
      bucket.perpSeenTs = null;
      return;
    }
    bucket.perpBook = { ...tick };
    bucket.perpSeenTs = this.clock.now();
  }

  onMarkFunding(tick: MarkFunding): void {
    const bucket = this.buckets.get(tick.symbol);
    if (!bucket || this.outOfOrder(tick.ts, bucket.markFunding?.ts)) return;
    const nextFundingValid =
      tick.nextFundingTs === null ||
      (this.validTimestamp(tick.nextFundingTs) &&
        tick.nextFundingTs >= tick.ts - this.cfg.maxFutureSkewMs &&
        tick.nextFundingTs <= tick.ts + this.cfg.fundingPeriodMs * 2);
    if (
      !this.freshTimestamp(tick.ts, this.cfg.fundingStaleMs) ||
      !finitePositive(tick.markPrice) ||
      !finite(tick.fundingRate) ||
      Math.abs(tick.fundingRate) > MAX_ABS_FUNDING_RATE ||
      !nextFundingValid
    ) {
      bucket.markFunding = null;
      bucket.markSeenTs = null;
      return;
    }

    bucket.markFunding = { ...tick };
    bucket.markSeenTs = this.clock.now();
    const history = bucket.fundingHistory;
    const last = history[history.length - 1];
    if (!last || last.fundingRate !== tick.fundingRate) {
      history.push({ fundingRate: tick.fundingRate, ts: tick.ts });
      this.trimFundingHistory(history);
    }
  }

  onSpotDepth(ladder: DepthLadder): void {
    this.onDepth(ladder, 'spotDepth');
  }

  onPerpDepth(ladder: DepthLadder): void {
    this.onDepth(ladder, 'perpDepth');
  }

  onBorrowInfo(info: BorrowInfo): void {
    if (!info || !ASSET_RE.test(info.asset)) return;
    const knownAsset = [...this.buckets.values()].some((bucket) => bucket.meta.base === info.asset);
    if (!knownAsset) return;
    const previous = this.borrowByAsset.get(info.asset);
    if (this.outOfOrder(info.asOfTs, previous?.asOfTs)) return;
    if (!this.freshTimestamp(info.asOfTs, this.cfg.borrowStaleMs) || !this.validBorrow(info)) {
      this.borrowByAsset.delete(info.asset);
      return;
    }
    this.borrowByAsset.set(info.asset, { ...info });
  }

  seedFundingHistory(symbol: string, points: FundingHistoryPoint[]): void {
    const bucket = this.buckets.get(symbol);
    if (!bucket || !Array.isArray(points)) return;
    const now = this.clock.now();
    const clean = points
      .filter((point) => finite(point?.fundingRate) && Math.abs(point.fundingRate) <= MAX_ABS_FUNDING_RATE && this.validTimestamp(point?.ts) && point.ts <= now + this.cfg.maxFutureSkewMs)
      .sort((left, right) => left.ts - right.ts)
      .filter((point, index, rows) => index === 0 || point.ts > rows[index - 1].ts)
      .map((point) => ({ ...point }));
    bucket.fundingHistory = clean.slice(-this.cfg.fundingHistoryKeep);
  }

  symbols(): string[] {
    return [...this.buckets.keys()];
  }

  hasSymbol(symbol: string): boolean {
    return this.buckets.has(symbol);
  }

  meta(symbol: string): SymbolMeta | null {
    const meta = this.buckets.get(symbol)?.meta;
    return meta ? cloneMeta(meta) : null;
  }

  universe(): SymbolMeta[] {
    return [...this.buckets.values()].map((bucket) => cloneMeta(bucket.meta));
  }

  spotBook(symbol: string): BookTicker | null {
    const value = this.buckets.get(symbol)?.spotBook;
    return value ? { ...value } : null;
  }

  perpBook(symbol: string): BookTicker | null {
    const value = this.buckets.get(symbol)?.perpBook;
    return value ? { ...value } : null;
  }

  markFunding(symbol: string): MarkFunding | null {
    const value = this.buckets.get(symbol)?.markFunding;
    return value ? { ...value } : null;
  }

  spotDepth(symbol: string): DepthLadder | null {
    return this.cloneDepth(this.buckets.get(symbol)?.spotDepth ?? null);
  }

  perpDepth(symbol: string): DepthLadder | null {
    return this.cloneDepth(this.buckets.get(symbol)?.perpDepth ?? null);
  }

  fundingHistory(symbol: string): FundingHistoryPoint[] {
    return (this.buckets.get(symbol)?.fundingHistory ?? []).map((point) => ({ ...point }));
  }

  borrowForSymbol(symbol: string): BorrowInfo | null {
    const meta = this.buckets.get(symbol)?.meta;
    if (!meta) return null;
    const info = this.borrowByAsset.get(meta.base);
    return info ? { ...info } : null;
  }

  spotStalenessMs(symbol: string): number | null {
    const bucket = this.buckets.get(symbol);
    const ref = bucket?.spotBook?.ts ?? bucket?.spotSeenTs ?? null;
    return ref === null ? null : Math.max(0, this.clock.now() - ref);
  }

  perpStalenessMs(symbol: string): number | null {
    const bucket = this.buckets.get(symbol);
    const ref = bucket?.perpBook?.ts ?? bucket?.perpSeenTs ?? null;
    return ref === null ? null : Math.max(0, this.clock.now() - ref);
  }

  markStalenessMs(symbol: string): number | null {
    const bucket = this.buckets.get(symbol);
    const ref = bucket?.markFunding?.ts ?? bucket?.markSeenTs ?? null;
    return ref === null ? null : Math.max(0, this.clock.now() - ref);
  }

  legSkewMs(symbol: string): number | null {
    const bucket = this.buckets.get(symbol);
    if (!bucket?.spotBook || !bucket.perpBook) return null;
    return Math.abs(bucket.spotBook.ts - bucket.perpBook.ts);
  }

  private validBook(tick: BookTicker): boolean {
    return (
      finitePositive(tick.bid) &&
      finitePositive(tick.ask) &&
      finitePositive(tick.bidQty) &&
      finitePositive(tick.askQty) &&
      tick.bid <= tick.ask
    );
  }

  private validBorrow(info: BorrowInfo): boolean {
    if (!['unknown', 'available', 'unavailable'].includes(info.status)) return false;
    const validMax = info.maxBorrowableBase === null || (finite(info.maxBorrowableBase) && info.maxBorrowableBase >= 0 && info.maxBorrowableBase <= MAX_MARKET_NUMBER);
    const validRate = info.hourlyRatePct === null || (finite(info.hourlyRatePct) && info.hourlyRatePct >= 0 && info.hourlyRatePct <= 100);
    if (!validMax || !validRate) return false;
    if (info.status === 'available') return info.maxBorrowableBase !== null && info.hourlyRatePct !== null;
    return true;
  }

  private onDepth(ladder: DepthLadder, key: 'spotDepth' | 'perpDepth'): void {
    const bucket = this.buckets.get(ladder.symbol);
    const previous = bucket?.[key];
    if (!bucket || this.outOfOrder(ladder.ts, previous?.ts)) return;
    if (!this.freshTimestamp(ladder.ts, this.cfg.staleMs) || !this.validDepth(ladder)) {
      bucket[key] = null;
      return;
    }
    bucket[key] = this.cloneDepth(ladder);
  }

  private validDepth(ladder: DepthLadder): boolean {
    if (
      !Array.isArray(ladder.bids) ||
      !Array.isArray(ladder.asks) ||
      ladder.bids.length > this.cfg.maxDepthLevels ||
      ladder.asks.length > this.cfg.maxDepthLevels
    ) return false;
    const sideValid = (levels: LadderLevel[], descending: boolean): boolean => {
      let previous: number | null = null;
      for (const row of levels) {
        if (!Array.isArray(row) || row.length !== 2 || !finitePositive(row[0]) || !finitePositive(row[1])) return false;
        if (previous !== null && (descending ? row[0] > previous : row[0] < previous)) return false;
        previous = row[0];
      }
      return true;
    };
    if (!sideValid(ladder.bids, true) || !sideValid(ladder.asks, false)) return false;
    return ladder.bids.length === 0 || ladder.asks.length === 0 || ladder.bids[0][0] <= ladder.asks[0][0];
  }

  private cloneDepth(ladder: DepthLadder | null): DepthLadder | null {
    if (!ladder) return null;
    return {
      symbol: ladder.symbol,
      ts: ladder.ts,
      bids: ladder.bids.map(([price, qty]) => [price, qty]),
      asks: ladder.asks.map(([price, qty]) => [price, qty]),
    };
  }

  private outOfOrder(timestamp: number, previous: number | undefined): boolean {
    return finite(previous) && finite(timestamp) && timestamp < previous;
  }

  private freshTimestamp(timestamp: number, maxAgeMs: number): boolean {
    if (!this.validTimestamp(timestamp)) return false;
    const delta = this.clock.now() - timestamp;
    return delta >= -this.cfg.maxFutureSkewMs && delta <= maxAgeMs;
  }

  private validTimestamp(timestamp: unknown): timestamp is number {
    return typeof timestamp === 'number' && Number.isSafeInteger(timestamp) && timestamp > 0;
  }

  private trimFundingHistory(history: FundingHistoryPoint[]): void {
    if (history.length > this.cfg.fundingHistoryKeep) {
      history.splice(0, history.length - this.cfg.fundingHistoryKeep);
    }
  }
}
