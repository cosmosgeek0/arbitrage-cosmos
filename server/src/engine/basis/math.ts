/**
 * Basis engine — pure math. No state, no clock, no I/O. Everything here is
 * unit-testable with plain numbers.
 */
import type { BookTicker } from '../v0/types.js';
import type { BasisDirection, CostBreakdown, DepthLadder, LadderLevel } from './types.js';

// ---------- spreads / gaps ----------

export function spreadBps(bid: number, ask: number): number | null {
  if (!(bid > 0) || !(ask > 0) || ask < bid) return null;
  const mid = (bid + ask) / 2;
  return ((ask - bid) / mid) * 10_000;
}

/**
 * Direction A — perp expensive: buy spot at ask, short perp at bid.
 * Executable gap = (perpBid − spotAsk) / spotAsk, pct.
 */
export function gapLongSpotShortPerpPct(spotAsk: number, perpBid: number): number | null {
  if (!(spotAsk > 0) || !(perpBid > 0)) return null;
  return ((perpBid - spotAsk) / spotAsk) * 100;
}

/**
 * Direction B — spot expensive: borrow base, sell spot at bid, long perp at ask.
 * Executable gap = (spotBid − perpAsk) / perpAsk, pct.
 */
export function gapShortSpotLongPerpPct(spotBid: number, perpAsk: number): number | null {
  if (!(spotBid > 0) || !(perpAsk > 0)) return null;
  return ((spotBid - perpAsk) / perpAsk) * 100;
}

export function bookMid(t: BookTicker): number | null {
  if (!(t.bid > 0) || !(t.ask > 0)) return null;
  return (t.bid + t.ask) / 2;
}

/** |perp mid − mark| in bps of mark. Large values smell like a bad tick. */
export function markDivergenceBps(perpMid: number, mark: number): number | null {
  if (!(perpMid > 0) || !(mark > 0)) return null;
  return (Math.abs(perpMid - mark) / mark) * 10_000;
}

// ---------- fees ----------

/**
 * 4-leg taker fee model: open both legs + close both legs.
 * A round trip touches spot twice and perp twice regardless of direction.
 */
export function fourLegFeesPct(spotTakerFeePct: number, perpTakerFeePct: number): number {
  return 2 * spotTakerFeePct + 2 * perpTakerFeePct;
}

// ---------- slippage / depth ----------

/**
 * Walk a ladder consuming `notionalUsd` and return the average-fill slippage
 * vs the touch, pct. Returns null when the ladder cannot fill the size.
 */
export function ladderSlippagePct(levels: LadderLevel[], notionalUsd: number): number | null {
  if (levels.length === 0 || !(notionalUsd > 0)) return null;
  const touch = levels[0][0];
  if (!(touch > 0)) return null;
  let remaining = notionalUsd;
  let costUsd = 0;
  let filledBase = 0;
  for (const [px, qty] of levels) {
    const levelUsd = px * qty;
    const take = Math.min(remaining, levelUsd);
    costUsd += take;
    filledBase += take / px;
    remaining -= take;
    if (remaining <= 0) break;
  }
  if (remaining > 0) return null; // ladder too thin for the size
  const avgPx = costUsd / filledBase;
  return (Math.abs(avgPx - touch) / touch) * 100;
}

/**
 * Top-of-book fallback slippage model when no ladder exists: impact grows with
 * the share of visible size we would consume. Crude by design — the point is a
 * monotonic, explainable penalty, not a microstructure thesis.
 */
export function topOfBookSlippagePct(
  touchPx: number,
  touchQty: number,
  notionalUsd: number,
  baseSlippagePct: number,
): number {
  if (!(touchPx > 0) || !(touchQty > 0) || !(notionalUsd > 0)) return baseSlippagePct * 4;
  const visibleUsd = touchPx * touchQty;
  const consumption = notionalUsd / visibleUsd;
  // consuming ≤25% of the touch ≈ base estimate; scale up beyond that
  return baseSlippagePct * Math.max(1, consumption / 0.25);
}

/**
 * Depth score 0..1 at intended size. 1 = the touch alone covers the size many
 * times over; 0 = ladder/touch cannot cover it.
 */
export function depthScoreAtSize(
  levels: LadderLevel[] | null,
  touchPx: number | null,
  touchQty: number | null,
  notionalUsd: number,
): number | null {
  if (!(notionalUsd > 0)) return null;
  let visibleUsd = 0;
  if (levels && levels.length > 0) {
    for (const [px, qty] of levels) visibleUsd += px * qty;
  } else if (touchPx && touchQty && touchPx > 0 && touchQty > 0) {
    visibleUsd = touchPx * touchQty;
  } else {
    return null;
  }
  const coverage = visibleUsd / notionalUsd;
  // coverage 10× → 1.0; 1× → ~0.32; <1× → proportionally poor
  return Math.max(0, Math.min(1, Math.log10(1 + coverage) / Math.log10(11)));
}

// ---------- rolling stats ----------

export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdDev(xs: number[]): number | null {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** Coefficient of variation, guarded for near-zero means. */
export function coefficientOfVariation(xs: number[]): number | null {
  const m = mean(xs);
  const s = stdDev(xs);
  if (m === null || s === null) return null;
  const denom = Math.max(Math.abs(m), 1e-9);
  return s / denom;
}

/**
 * Least-squares slope of (ts, value) samples, expressed per minute.
 * Returns null with <2 distinct timestamps.
 */
export function slopePerMinute(samples: Array<{ ts: number; v: number }>): number | null {
  if (samples.length < 2) return null;
  const n = samples.length;
  const t0 = samples[0].ts;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const { ts, v } of samples) {
    const x = (ts - t0) / 60_000;
    sumX += x;
    sumY += v;
    sumXY += x * v;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

// ---------- funding carry ----------

/**
 * Signed funding carry from the discrete funding timestamps crossed by a hold,
 * pct of notional. `knownSettlementRates[0]` belongs to the supplied next
 * funding timestamp; later entries, when present, belong to subsequent periods.
 * A crossed timestamp with no known rate stays unknown rather than being
 * prorated from the current rate.
 */
export function fundingCarryPctOverHold(
  knownSettlementRates: readonly number[],
  direction: BasisDirection,
  holdMs: number,
  fundingPeriodMs: number,
  msToNextFunding: number,
): number | null {
  if (!Number.isFinite(holdMs) || holdMs < 0
    || !Number.isFinite(fundingPeriodMs) || fundingPeriodMs <= 0
    || !Number.isFinite(msToNextFunding) || msToNextFunding <= 0) return null;
  if (msToNextFunding > holdMs) return 0;
  const settlementCount = 1 + Math.floor((holdMs - msToNextFunding) / fundingPeriodMs);
  if (!Number.isSafeInteger(settlementCount)
    || settlementCount < 1
    || settlementCount > knownSettlementRates.length) return null;
  const rates = knownSettlementRates.slice(0, settlementCount);
  if (rates.some((rate) => !Number.isFinite(rate) || Math.abs(rate) > 0.1)) return null;
  const receivesWhenPositive = direction === 'long_spot_short_perp';
  const sign = receivesWhenPositive ? 1 : -1;
  return rates.reduce((total, rate) => total + rate * 100 * sign, 0);
}

/** Borrow interest over the hold, pct of notional (reverse basis only). */
export function borrowCostPctOverHold(hourlyRatePct: number, holdMs: number): number {
  return hourlyRatePct * (holdMs / 3_600_000);
}

// ---------- cost assembly ----------

export function assembleCosts(parts: {
  feesPct: number;
  slippagePct: number;
  fundingCarryPct: number; // signed
  borrowCostPct: number;
}): CostBreakdown {
  const fundingDragPct = parts.fundingCarryPct < 0 ? -parts.fundingCarryPct : 0;
  return {
    feesPct: parts.feesPct,
    slippagePct: parts.slippagePct,
    fundingDragPct,
    borrowCostPct: parts.borrowCostPct,
    totalPct: parts.feesPct + parts.slippagePct + fundingDragPct + parts.borrowCostPct,
  };
}

/** net = gross − all costs + positive funding carry (drag already in costs). */
export function netEdgePct(grossPct: number, costs: CostBreakdown, fundingCarryPct: number): number {
  const bonus = fundingCarryPct > 0 ? fundingCarryPct : 0;
  return grossPct - costs.totalPct + bonus;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function ladderFromDepth(ladder: DepthLadder | null, side: 'bids' | 'asks'): LadderLevel[] | null {
  if (!ladder) return null;
  const rows = ladder[side];
  return rows.length > 0 ? rows : null;
}
