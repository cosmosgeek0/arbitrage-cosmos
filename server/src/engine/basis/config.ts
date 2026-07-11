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
  /** mark/funding observations older than this are unusable for pricing */
  fundingStaleMs: number;
  /** signed borrow preflight observations older than this are unusable */
  borrowStaleMs: number;
  /** small clock-skew allowance; observations further in the future are rejected */
  maxFutureSkewMs: number;

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

  // --- bounded state ---
  maxUniverseSize: number;
  maxDepthLevels: number;
  fundingHistoryKeep: number;
  proposalHistoryKeep: number;

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
  fundingStaleMs: 10_000,
  borrowStaleMs: 60_000,
  maxFutureSkewMs: 2_000,

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

  maxUniverseSize: 2_500,
  maxDepthLevels: 5_000,
  fundingHistoryKeep: 32,
  proposalHistoryKeep: 2_000,

  priorityMomentumWeight: 0.25,
};

export function basisConfig(partial?: Partial<BasisConfig>): BasisConfig {
  const cfg: BasisConfig = {
    ...BASIS_DEFAULTS,
    ...(partial ?? {}),
    stagedSizeFractions: [...(partial?.stagedSizeFractions ?? BASIS_DEFAULTS.stagedSizeFractions)],
  };

  const finite = (name: keyof BasisConfig, min: number, max = Number.MAX_SAFE_INTEGER): void => {
    const value = cfg[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`invalid basis config ${String(name)}: expected finite ${min}..${max}`);
    }
  };
  const integer = (name: keyof BasisConfig, min: number, max = Number.MAX_SAFE_INTEGER): void => {
    finite(name, min, max);
    if (!Number.isInteger(cfg[name])) throw new RangeError(`invalid basis config ${String(name)}: expected integer`);
  };

  for (const name of [
    'feesPct',
    'minNetBasisPct',
    'slippagePctEstimate',
    'maxSpreadBps',
    'cooldownMs',
    'minQuoteVolume24hUsd',
    'vol1sMultiple',
    'vol5sMultiple',
    'minTradeCountMultiple',
    'minFollowthroughPct',
    'maxExtendedMovePct',
    'watchGapPct',
    'focusGapPct',
    'spotTakerFeePct',
    'perpTakerFeePct',
    'maxFutureSkewMs',
    'maxGapCv',
    'maxFundingDragPct',
    'fundingExtremeAbs',
    'maxBorrowHourlyRatePct',
    'priorityMomentumWeight',
  ] as const) finite(name, 0);

  for (const name of [
    'staleMs',
    'focusMaxAgeMs',
    'candidateTtlMs',
    'proposalTtlMs',
    'suggestedNotionalUsd',
    'tickMs',
    'heartbeatMs',
    'maxLegSkewMs',
    'maxMarkDivergenceBps',
    'fundingStaleMs',
    'borrowStaleMs',
    'defaultHoldMs',
    'minHoldMs',
    'maxHoldMs',
    'fundingPeriodMs',
    'borrowSafetyFactor',
  ] as const) finite(name, Number.MIN_VALUE);

  for (const name of [
    'persistTicks',
    'baselineMinSamples',
    'onePrintMaxTrades',
    'focusSoftCap',
    'focusHardCap',
    'gapWindowSize',
    'maxUniverseSize',
    'maxDepthLevels',
    'fundingHistoryKeep',
    'proposalHistoryKeep',
  ] as const) integer(name, 1, name === 'maxUniverseSize' || name === 'maxDepthLevels' ? 10_000 : Number.MAX_SAFE_INTEGER);

  finite('minDepthScore', 0, 1);
  finite('minDataQuality', 0, 1);
  for (const name of ['minNetBasisPct', 'watchGapPct', 'maxFundingDragPct'] as const) {
    if (cfg[name] <= 0) throw new RangeError(`invalid basis config ${name}: expected > 0`);
  }
  if (cfg.focusSoftCap > cfg.focusHardCap) throw new RangeError('invalid basis config: focusSoftCap exceeds focusHardCap');
  if (cfg.watchGapPct > cfg.focusGapPct) throw new RangeError('invalid basis config: watchGapPct exceeds focusGapPct');
  if (cfg.minHoldMs > cfg.defaultHoldMs || cfg.defaultHoldMs > cfg.maxHoldMs) {
    throw new RangeError('invalid basis config: expected minHoldMs <= defaultHoldMs <= maxHoldMs');
  }
  if (!Number.isFinite(cfg.maxHoldMs / cfg.fundingPeriodMs) || cfg.maxHoldMs / cfg.fundingPeriodMs > 1_000) {
    throw new RangeError('invalid basis config: hold/funding period ratio is unsafe');
  }
  if (cfg.gapWindowSize < 3 || cfg.fundingHistoryKeep < 3) {
    throw new RangeError('invalid basis config: rolling history sizes must be at least 3');
  }
  if (cfg.stagedSizeFractions.length === 0 || cfg.stagedSizeFractions.length > 16) {
    throw new RangeError('invalid basis config stagedSizeFractions length');
  }
  let previous = 0;
  for (const fraction of cfg.stagedSizeFractions) {
    if (!Number.isFinite(fraction) || fraction <= previous || fraction > 1) {
      throw new RangeError('invalid basis config stagedSizeFractions: expected unique ascending values in (0, 1]');
    }
    previous = fraction;
  }
  return cfg;
}
