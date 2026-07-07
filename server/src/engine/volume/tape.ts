/**
 * Trade-pressure / tape-forensics analyzer. Pure functions over the bounded
 * raw-trade window. This is where fake wakeups die: one-print spikes, wash-y
 * uniform tape, burst structure, taker conviction.
 */
import type { BurstStats, RawTrade, TapeAnalysis } from './types.js';
import type { VolumeConfig } from './config.js';

function burstStats(trades: RawTrade[], clusterGapMs: number): BurstStats {
  let maxClusterTrades = 0;
  let maxClusterQuote = 0;
  let maxClusterSpanMs = 0;
  let clusterCount = 0;
  let curTrades = 0;
  let curQuote = 0;
  let curStart = 0;
  let prevTs = -Infinity;
  const flush = (endTs: number) => {
    if (curTrades === 0) return;
    clusterCount++;
    if (curQuote > maxClusterQuote) {
      maxClusterQuote = curQuote;
      maxClusterTrades = curTrades;
      maxClusterSpanMs = endTs - curStart;
    }
    curTrades = 0;
    curQuote = 0;
  };
  for (const t of trades) {
    if (t.ts - prevTs > clusterGapMs) {
      flush(prevTs);
      curStart = t.ts;
    }
    curTrades++;
    curQuote += t.quoteQty;
    prevTs = t.ts;
  }
  flush(prevTs);
  return { maxClusterTrades, maxClusterQuote, maxClusterSpanMs, clusterCount };
}

/**
 * Wash-uniformity score 0..1 (invented signal, see VolumeDetailCode).
 * Real wakeups have heterogeneous sizes, directional taker flow, and price
 * displacement. Wash-y tape repeats the same size, ping-pongs maker side,
 * and leaves price flat. Score = mean of three sub-signals.
 */
function washScoreOf(trades: RawTrade[], priceRangePct: number, cfg: VolumeConfig): number {
  if (trades.length < cfg.washMinTrades) return 0;
  // 1) modal-size share: fraction of trades whose qty matches the most common qty (0.1% tolerance)
  const counts = new Map<string, number>();
  for (const t of trades) {
    const key = t.qty.toPrecision(4); // relative binning — wash prints repeat sizes near-exactly
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let modal = 0;
  for (const c of counts.values()) if (c > modal) modal = c;
  const uniformity = modal / trades.length;
  // 2) side alternation: perfect buy/sell ping-pong → 1
  let flips = 0;
  for (let i = 1; i < trades.length; i++)
    if (trades[i].isBuyerMaker !== trades[i - 1].isBuyerMaker) flips++;
  const alternation = flips / (trades.length - 1);
  // 3) price flatness relative to the flat-range threshold
  const flatness = Math.max(0, 1 - priceRangePct / Math.max(cfg.washFlatRangePct, 1e-9));
  return (uniformity + alternation + flatness) / 3;
}

export function analyzeTape(trades: RawTrade[], windowMs: number, cfg: VolumeConfig): TapeAnalysis {
  let quoteVolume = 0;
  let takerBuyQuote = 0;
  let maxTradeQuote = 0;
  let maxTradePrintCount = 1;
  let hi = -Infinity;
  let lo = Infinity;
  for (const t of trades) {
    quoteVolume += t.quoteQty;
    if (!t.isBuyerMaker) takerBuyQuote += t.quoteQty;
    if (t.quoteQty > maxTradeQuote) {
      maxTradeQuote = t.quoteQty;
      maxTradePrintCount = t.printCount;
    }
    if (t.price > hi) hi = t.price;
    if (t.price < lo) lo = t.price;
  }
  const priceRangePct = trades.length > 0 && lo > 0 ? ((hi - lo) / lo) * 100 : 0;
  const washReady = trades.length >= cfg.washMinTrades;
  return {
    windowMs,
    trades: trades.length,
    quoteVolume,
    maxTradeDominance: quoteVolume > 0 ? maxTradeQuote / quoteVolume : 0,
    maxTradePrintCount,
    takerBuyRatio: trades.length >= cfg.minTradesForImbalance ? takerBuyQuote / quoteVolume : null,
    burst: burstStats(trades, cfg.clusterGapMs),
    washScore: washScoreOf(trades, priceRangePct, cfg),
    washReady,
    priceRangePct,
  };
}
