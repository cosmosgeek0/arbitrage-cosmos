/**
 * Volume/wakeup engine config — extends the frozen chassis defaults with the
 * knobs this lane's extra signals need. v0/config.ts is READ-ONLY; we layer,
 * never edit.
 */
import { ENGINE_DEFAULTS, type EngineConfig } from '../v0/config.js';

export interface VolumeConfig extends EngineConfig {
  // ---- tape / raw trade window ----
  rawTradeWindowMs: number; // how long raw trades are kept for forensics
  maxRawTrades: number; // hard bound per symbol
  largeTradeQuoteUsd: number; // "large trade" threshold for bucket counters
  clusterGapMs: number; // trades closer than this belong to one burst cluster

  // ---- fake-detection ----
  /** single-trade share of trigger-window volume above this ⇒ one-print suspect */
  onePrintDominanceRatio: number;
  /** wash score at/above this ⇒ wash_uniformity_suspect */
  washScoreThreshold: number;
  washMinTrades: number; // washScore not meaningful below this many trades
  /** price range (pct) under which uniform ping-pong tape reads as wash-y */
  washFlatRangePct: number;

  // ---- taker conviction ----
  minTradesForImbalance: number;
  /** |takerBuyRatio − 0.5| must reach this in the move's direction */
  minTakerImbalance: number;

  // ---- activation / confirmation ----
  /** absolute 1s quote-volume floor for activation: a $75 print on a dead
   * symbol is 15× its norm but still dust, not a tradeable wakeup */
  minActivationQuote1s: number;
  vol15sMultiple: number; // 15s continuation multiple
  /** fraction of the 1s trigger at which a symbol becomes WATCHING */
  watchFraction: number;
  /** min ms in FOCUS (verification dwell) before a proposal may be emitted */
  minFocusDwellMs: number;
  /** within this many ms of the 1s trigger, failing SOFT checks (one-print,
   * trade count, conviction, follow-through) yields `watch`, not a premature
   * reject — a 2-second-old real wakeup looks exactly like a fake */
  verificationGraceMs: number;

  // ---- baseline ----
  baselineWindowMinutes: number; // ring size of per-minute samples
  /** floor for per-second quote-volume norm so dead symbols keep finite multiples */
  baselineFloorQuotePerSec: number;
  /** per-minute quote volume at/below this ⇒ symbol counts as dead/quiet */
  deadMaxQuotePerMin: number;

  // ---- depth quality ----
  benchmarkDepthUsd: number; // top-of-book USD that scores depthScore = ~1
  bookHistorySize: number; // samples for the rolling depth norm
  /** topDepthUsd / rolling-median below this while volume spikes ⇒ depth_vanished */
  depthCollapseRatio: number;

  // ---- proposal invalidation ----
  volumeNormalizedBelowMultiple: number;
  spreadBlownOutBps: number;

  // ---- priority ----
  freshnessHalfLifeMs: number; // signal-age decay half-life
  focusAgePenaltyAfterMs: number; // focus sessions older than this decay in rank
}

export const VOLUME_DEFAULTS: VolumeConfig = {
  ...ENGINE_DEFAULTS,

  rawTradeWindowMs: 15_000,
  maxRawTrades: 512,
  largeTradeQuoteUsd: 5_000,
  clusterGapMs: 300,

  onePrintDominanceRatio: 0.75,
  washScoreThreshold: 0.7,
  washMinTrades: 12,
  washFlatRangePct: 0.05,

  minTradesForImbalance: 8,
  minTakerImbalance: 0.12,

  minActivationQuote1s: 250,
  vol15sMultiple: 2.5,
  watchFraction: 0.5,
  minFocusDwellMs: 4_000,
  verificationGraceMs: 3_000,

  baselineWindowMinutes: 240,
  baselineFloorQuotePerSec: 1,
  deadMaxQuotePerMin: 500,

  benchmarkDepthUsd: 25_000,
  bookHistorySize: 60,
  depthCollapseRatio: 0.35,

  volumeNormalizedBelowMultiple: 1.5,
  spreadBlownOutBps: 50,

  freshnessHalfLifeMs: 30_000,
  focusAgePenaltyAfterMs: 5 * 60_000,
};

export function volumeConfig(partial?: Partial<VolumeConfig>): VolumeConfig {
  return { ...VOLUME_DEFAULTS, ...(partial ?? {}) };
}
