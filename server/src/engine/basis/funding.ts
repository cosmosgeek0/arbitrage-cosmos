/**
 * Basis engine — funding model.
 * Funding is a first-class cost/bonus, not an afterthought: carry over the
 * expected hold, flip risk from recent history, and a capture factor when a
 * paying funding event lands inside the hold.
 */
import type { MarkFunding } from '../v0/types.js';
import { clamp, fundingCarryPctOverHold } from './math.js';
import type { BasisConfig } from './config.js';
import type { BasisDirection, FundingContext, FundingHistoryPoint, GapState } from './types.js';

/**
 * Expected hold from gap dynamics: a gap closing at |slope| pct/min should take
 * roughly gap/|slope| minutes to converge. Widening or flat gaps fall back to
 * the configured default. Always clamped to [minHoldMs, maxHoldMs].
 */
export function expectedHoldMs(gap: GapState, cfg: BasisConfig): number {
  const { gapPct, slopePctPerMin } = gap;
  if (
    gapPct !== null &&
    gapPct > 0 &&
    slopePctPerMin !== null &&
    slopePctPerMin < -1e-6 // closing
  ) {
    const minutes = gapPct / -slopePctPerMin;
    return clamp(minutes * 60_000, cfg.minHoldMs, cfg.maxHoldMs);
  }
  return clamp(cfg.defaultHoldMs, cfg.minHoldMs, cfg.maxHoldMs);
}

/**
 * Flip risk 0..1 from recent funding history: sign instability and near-zero
 * magnitude both make the current funding sign untrustworthy.
 */
export function fundingFlipRisk(history: FundingHistoryPoint[], current: number | null): number | null {
  const rates = history.map((h) => h.fundingRate).filter(Number.isFinite);
  if (rates.length < 3) return null;
  let flips = 0;
  for (let i = 1; i < rates.length; i++) {
    if (Math.sign(rates[i]) !== Math.sign(rates[i - 1]) && rates[i] !== 0 && rates[i - 1] !== 0) flips++;
  }
  const flipShare = flips / (rates.length - 1);
  // magnitude component: |rate| ≥ 5bps/period is a confident sign, ~0 is a coin toss
  const mag = Math.abs(current !== null && Number.isFinite(current) ? current : rates[rates.length - 1]);
  const magRisk = clamp(1 - mag / 0.0005, 0, 1);
  return clamp(0.6 * flipShare + 0.4 * magRisk, 0, 1);
}

/**
 * Build the full funding context for one direction. Positive carry = funding
 * pays this direction over the expected hold.
 */
export function buildFundingContext(
  mark: MarkFunding | null,
  history: FundingHistoryPoint[],
  direction: BasisDirection,
  gap: GapState,
  nowTs: number,
  cfg: BasisConfig,
  markStalenessMs: number | null = mark ? nowTs - mark.ts : null,
): FundingContext {
  const holdMs = expectedHoldMs(gap, cfg);
  const reportedStalenessMs = markStalenessMs === null ? null : Math.max(0, markStalenessMs);
  const fresh = Boolean(
    mark &&
      Number.isFinite(mark.fundingRate) &&
      Math.abs(mark.fundingRate) <= 0.1 &&
      Number.isFinite(mark.markPrice) &&
      mark.markPrice > 0 &&
      Number.isSafeInteger(mark.ts) &&
      mark.ts > 0 &&
      markStalenessMs !== null &&
      markStalenessMs >= -cfg.maxFutureSkewMs &&
      markStalenessMs <= cfg.fundingStaleMs,
  );
  if (!mark || !fresh) {
    return {
      fundingRate: null,
      stalenessMs: reportedStalenessMs,
      fresh: false,
      nextFundingTs: null,
      msToFunding: null,
      carryPctOverHold: null,
      expectedHoldMs: holdMs,
      flipRisk: null,
      captureFactor: 0,
    };
  }

  const msToFunding = mark.nextFundingTs === null ? null : Math.max(0, mark.nextFundingTs - nowTs);
  const rawCarry = fundingCarryPctOverHold(mark.fundingRate, direction, holdMs, cfg.fundingPeriodMs);
  const flipRisk = fundingFlipRisk(history, mark.fundingRate);
  // discount positive carry by flip risk — an unreliable bonus is not a bonus;
  // negative carry is NOT discounted (be pessimistic about drag)
  const carry = rawCarry > 0 && flipRisk !== null ? rawCarry * (1 - flipRisk) : rawCarry;

  // capture factor: a paying funding event landing inside the hold is worth a
  // priority bump; an imminent paying event even more so
  let captureFactor = 0;
  if (rawCarry > 0 && msToFunding !== null && msToFunding <= holdMs) {
    captureFactor = clamp(1 - msToFunding / cfg.fundingPeriodMs, 0, 1);
  }

  return {
    fundingRate: mark.fundingRate,
    stalenessMs: reportedStalenessMs,
    fresh: true,
    nextFundingTs: mark.nextFundingTs,
    msToFunding,
    carryPctOverHold: carry,
    expectedHoldMs: holdMs,
    flipRisk,
    captureFactor,
  };
}
