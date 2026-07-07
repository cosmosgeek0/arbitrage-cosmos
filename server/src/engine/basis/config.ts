/**
 * Basis engine configuration. Builds on the frozen v0 EngineConfig defaults
 * (never edited) and adds basis-specific knobs. Every threshold that produces
 * a named reject lives here so tests and the Director can tune without
 * touching logic.
 */
import { ENGINE_DEFAULTS, type EngineConfig } from '../v0/config.js';

export interface BasisConfig extends EngineConfig {
  // --- gap thresholds (gross executable gap, pct) ---
  /** gross gap that makes a symbol worth WATCHING */
  watchGapPct: number;
  /** gross gap that makes a symbol worth FOCUS (deeper data, stricter checks) */
  focusGapPct: number;

  // --- fee decomposition (sums ≈ v0 feesPct round trip) ---
  spotTakerFeePct: number; // per spot leg
  perpTakerFeePct: number; // per perp leg

  // --- data-quality guards ---
  /** max |spot book ts − perp book ts| before the cross-leg gap is fiction */
  maxLegSkewMs: number;
  /** max |perp mid − mark| in bps before the book smells like a bad tick */
  maxMarkDivergenceBps: number;
  /** below this composite data-quality score → data_stale reject */
  minDataQuality: number;

  // --- gap stability ---
  /** max coefficient of variation of the gap; noisier → gap_not_persistent */
  maxGapCv: number;
  /** samples kept in the gap tracking window */
  gapWindowSize: number;

  // --- funding model ---
  /** default expected hold when the gap slope gives no estimate, ms */
  defaultHoldMs: number;
  minHoldMs: number;
  maxHoldMs: number;
  /** funding period length, ms (Binance perps: 8h; some symbols 4h/1h — data-driven later) */
  fundingPeriodMs: number;
  /** negative carry beyond this pct of notional over the hold → funding_against_trade */
  maxFundingDragPct: number;
  /** |funding| above this is "extreme" (focus reason, priority factor) */
  fundingExtremeAbs: number;

  // --- borrow preflight (reverse basis) ---
  /** required borrow headroom: maxBorrowable must cover size × this factor */
  borrowSafetyFactor: number;
  /** hourly borrow rate above this → borrow_cost_too_high */
  maxBorrowHourlyRatePct: number;

  // --- sizing / proposals ---
  /** staged-size ladder fractions of suggestedNotionalUsd (metadata only) */
  stagedSizeFractions: number[];

  // --- priority weights (multiplicative model, each factor normalised 0..1+) ---
  priorityMomentumWeight: number;
}

export const BASIS_DEFAULTS: BasisConfig = {
  ...ENGINE_DEFAULTS,

  watchGapPct: 0.15,
  focusGapPct: 0.3,

  spotTakerFeePct: 0.1,
  perpTakerFeePct: 0.05,

  maxLegSkewMs: 2_500,
  maxMarkDivergenceBps: 50,
  minDataQuality: 0.4,

  maxGapCv: 0.6,
  gapWindowSize: 60,

  defaultHoldMs: 4 * 60 * 60_000,
  minHoldMs: 10 * 60_000,
  maxHoldMs: 24 * 60 * 60_000,
  fundingPeriodMs: 8 * 60 * 60_000,
  maxFundingDragPct: 0.15,
  fundingExtremeAbs: 0.0005,

  borrowSafetyFactor: 1.5,
  maxBorrowHourlyRatePct: 0.01,

  stagedSizeFractions: [0.25, 0.5, 1],

  priorityMomentumWeight: 0.25,
};

export function basisConfig(partial?: Partial<BasisConfig>): BasisConfig {
  return { ...BASIS_DEFAULTS, ...(partial ?? {}) };
}
