/**
 * Basis engine — edge assembly. Gross executable gap minus every itemised
 * cost (4-leg fees, slippage at size, funding drag, borrow interest), plus
 * positive funding carry. The breakdown ships with every proposal so the
 * owner can audit exactly where the edge goes.
 */
import { assembleCosts, fourLegFeesPct, netEdgePct } from './math.js';
import type { BasisConfig } from './config.js';
import type { BasisDirection, EdgeEstimate, FundingContext, GapState, LiquidityAssessment } from './types.js';

export function estimateEdge(
  direction: BasisDirection,
  gap: GapState,
  funding: FundingContext,
  liquidity: LiquidityAssessment,
  borrowCostPctOverHold: number,
  cfg: BasisConfig,
): EdgeEstimate {
  const fees = fourLegFeesPct(cfg.spotTakerFeePct, cfg.perpTakerFeePct);
  const carry = funding.carryPctOverHold ?? 0;
  const costs = assembleCosts({
    feesPct: fees,
    slippagePct: liquidity.slippagePct,
    fundingCarryPct: carry,
    borrowCostPct: borrowCostPctOverHold,
  });

  const gross = gap.gapPct;
  return {
    direction,
    grossEdgePct: gross,
    costs,
    netEdgePct: gross === null || funding.carryPctOverHold === null
      ? null
      : netEdgePct(gross, costs, carry),
    fundingAdjPct: funding.carryPctOverHold,
  };
}
