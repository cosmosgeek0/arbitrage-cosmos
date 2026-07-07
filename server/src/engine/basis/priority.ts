/**
 * Basis engine — explainable priority ranking.
 * score = netEdge × persistence × liquidity × fundingUsefulness × dataQuality,
 * modulated by gap momentum (widening gains, closing loses). Every component
 * ships with the score so the cockpit can show WHY a symbol ranks where it
 * does. Focus is scarce; this is the queue discipline.
 */
import { clamp } from './math.js';
import type { BasisConfig } from './config.js';
import type { BasisDirection, BasisFeatureSnapshot, PriorityScore } from './types.js';

export function priorityFor(
  bf: BasisFeatureSnapshot,
  direction: BasisDirection | null,
  cfg: BasisConfig,
): PriorityScore {
  const zero: PriorityScore = {
    symbol: bf.symbol,
    direction,
    score: 0,
    components: {
      netEdge: 0,
      persistence: 0,
      liquidity: 0,
      fundingUsefulness: 0,
      dataQuality: 0,
      momentum: 1,
    },
  };
  if (!bf.basis || direction === null) return zero;

  const s = bf.basis;
  const gap = direction === 'long_spot_short_perp' ? s.gapA : s.gapB;
  const funding = direction === 'long_spot_short_perp' ? s.funding.A : s.funding.B;
  const liq = direction === 'long_spot_short_perp' ? s.liquidity.A : s.liquidity.B;
  const edge = direction === 'long_spot_short_perp' ? s.edge.A : s.edge.B;

  // net edge normalised: hitting 2× the required threshold ≈ 1.0
  const netEdge = clamp((edge.netEdgePct ?? 0) / (cfg.minNetBasisPct * 2), 0, 1.5);

  // persistence saturates at the config requirement
  const persistence = clamp(gap.persistTicks / cfg.persistTicks, 0, 1);

  const liquidity = clamp(liq.depthScore ?? 0, 0, 1);

  // funding usefulness: paying carry (flip-risk discounted) helps; drag hurts
  const carry = funding.carryPctOverHold ?? 0;
  const fundingUsefulness = clamp(0.5 + carry / (2 * cfg.maxFundingDragPct) + 0.25 * funding.captureFactor, 0, 1);

  const dataQuality = clamp(s.dq.score, 0, 1);

  // momentum: widening slope boosts, closing slope drains (bounded)
  const slope = gap.slopePctPerMin ?? 0;
  const momentum = clamp(1 + cfg.priorityMomentumWeight * Math.tanh(slope / cfg.watchGapPct), 0.5, 1.5);

  const score = netEdge * Math.max(persistence, 0.1) * Math.max(liquidity, 0.05) * fundingUsefulness * dataQuality * momentum;

  return {
    symbol: bf.symbol,
    direction,
    score,
    components: { netEdge, persistence, liquidity, fundingUsefulness, dataQuality, momentum },
  };
}

/** Direction whose current gap is economically bigger (for ranking context). */
export function primaryDirection(bf: BasisFeatureSnapshot): BasisDirection | null {
  if (!bf.basis) return null;
  const a = bf.basis.gapA.gapPct;
  const b = bf.basis.gapB.gapPct;
  if (a === null && b === null) return null;
  return (a ?? -Infinity) >= (b ?? -Infinity) ? 'long_spot_short_perp' : 'short_spot_long_perp';
}
