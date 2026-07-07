/**
 * Per-symbol baseline: what "normal" looks like for THIS symbol, vs its own
 * history (ENGINE.md §7: compare a symbol to itself). Robust statistics —
 * median + MAD over completed per-minute samples — so one freak minute cannot
 * poison the norm. Dead symbols get a config floor so multiples stay finite.
 */
import type { BaselineStats } from './types.js';
import type { VolumeConfig } from './config.js';

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeBaseline(
  minuteSamples: { quoteVolume: number; tradeCount: number }[],
  cfg: VolumeConfig,
): BaselineStats {
  const samples = minuteSamples.length;
  const ready = samples >= cfg.baselineMinSamples;
  const quoteSorted = minuteSamples.map((s) => s.quoteVolume).sort((a, b) => a - b);
  const tradeSorted = minuteSamples.map((s) => s.tradeCount).sort((a, b) => a - b);
  const quoteMed = median(quoteSorted);
  const tradeMed = median(tradeSorted);
  const quoteMad = median(quoteSorted.map((v) => Math.abs(v - quoteMed)).sort((a, b) => a - b));
  const floorPerMin = cfg.baselineFloorQuotePerSec * 60;
  return {
    ready,
    samples,
    confidence: ready ? Math.min(1, samples / cfg.baselineWindowMinutes + 0.5) : samples / cfg.baselineMinSamples,
    quotePerSecNorm: Math.max(quoteMed, floorPerMin) / 60,
    tradesPerSecNorm: Math.max(tradeMed, 0.5) / 60,
    quotePerMinMedian: quoteMed,
    quotePerMinMad: quoteMad,
    isDead: ready && quoteMed <= cfg.deadMaxQuotePerMin,
  };
}

/**
 * Volume multiple of a window vs the symbol's own per-second norm.
 * Returns null when the baseline is not ready (never fabricate a multiple).
 */
export function volumeMultipleOf(
  windowQuoteVolume: number,
  windowSeconds: number,
  baseline: BaselineStats,
): number | null {
  if (!baseline.ready) return null;
  return windowQuoteVolume / (baseline.quotePerSecNorm * windowSeconds);
}

export function tradeCountMultipleOf(
  windowTradeCount: number,
  windowSeconds: number,
  baseline: BaselineStats,
): number | null {
  if (!baseline.ready) return null;
  return windowTradeCount / (baseline.tradesPerSecNorm * windowSeconds);
}
