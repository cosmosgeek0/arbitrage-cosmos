/**
 * Basis engine — liquidity assessment and data-quality scoring.
 *
 * Liquidity: can the intended size actually cross the legs it must hit,
 * and at what slippage? Direction A hits the spot ask + perp bid;
 * direction B hits the spot bid + perp ask.
 *
 * Data quality: a composite trust score over staleness, cross-leg timestamp
 * skew, mark-book divergence and ladder availability. A beautiful gap computed
 * from garbage inputs is garbage.
 */
import type { BookTicker } from '../v0/types.js';
import {
  bookMid,
  clamp,
  depthScoreAtSize,
  ladderFromDepth,
  ladderSlippagePct,
  markDivergenceBps,
  topOfBookSlippagePct,
} from './math.js';
import type { BasisConfig } from './config.js';
import type { BasisDirection, DataQuality, DepthLadder, LiquidityAssessment } from './types.js';

/** Which ladder sides a direction consumes on each leg. */
function sidesFor(direction: BasisDirection): { spot: 'bids' | 'asks'; perp: 'bids' | 'asks' } {
  return direction === 'long_spot_short_perp'
    ? { spot: 'asks', perp: 'bids' } // buy spot (hit asks), short perp (hit bids)
    : { spot: 'bids', perp: 'asks' }; // sell spot (hit bids), long perp (hit asks)
}

export function assessLiquidity(
  direction: BasisDirection,
  spotBook: BookTicker | null,
  perpBook: BookTicker | null,
  spotDepth: DepthLadder | null,
  perpDepth: DepthLadder | null,
  notionalUsd: number,
  cfg: BasisConfig,
): LiquidityAssessment {
  const sides = sidesFor(direction);

  const spotLadder = ladderFromDepth(spotDepth, sides.spot);
  const perpLadder = ladderFromDepth(perpDepth, sides.perp);

  const spotTouchPx = sides.spot === 'asks' ? spotBook?.ask : spotBook?.bid;
  const spotTouchQty = sides.spot === 'asks' ? spotBook?.askQty : spotBook?.bidQty;
  const perpTouchPx = sides.perp === 'asks' ? perpBook?.ask : perpBook?.bid;
  const perpTouchQty = sides.perp === 'asks' ? perpBook?.askQty : perpBook?.bidQty;

  // --- per-leg depth scores at the intended size ---
  const spotScore = depthScoreAtSize(spotLadder, spotTouchPx ?? null, spotTouchQty ?? null, notionalUsd);
  const perpScore = depthScoreAtSize(perpLadder, perpTouchPx ?? null, perpTouchQty ?? null, notionalUsd);
  // a two-leg trade is only as deep as its thinner leg
  const depthScore = spotScore === null || perpScore === null ? null : Math.min(spotScore, perpScore);

  // --- slippage: ladder walk when we have ladders, top-of-book impact otherwise ---
  const legSlippage = (
    ladder: ReturnType<typeof ladderFromDepth>,
    touchPx: number | undefined,
    touchQty: number | undefined,
  ): number => {
    if (ladder) {
      const walked = ladderSlippagePct(ladder, notionalUsd);
      if (walked !== null) return walked;
      return cfg.slippagePctEstimate * 4; // ladder too thin for size
    }
    return topOfBookSlippagePct(touchPx ?? 0, touchQty ?? 0, notionalUsd, cfg.slippagePctEstimate / 2);
  };
  const slippagePct =
    legSlippage(spotLadder, spotTouchPx, spotTouchQty) + legSlippage(perpLadder, perpTouchPx, perpTouchQty);

  // --- book pressure: qty on the sides we must HIT vs the opposite sides.
  // If the liquidity we need is thin relative to what faces it, fills degrade. ---
  let bookPressure: number | null = null;
  if (spotBook && perpBook) {
    const hitQtyUsd =
      (spotTouchPx ?? 0) * (spotTouchQty ?? 0) + (perpTouchPx ?? 0) * (perpTouchQty ?? 0);
    const oppSpotPx = sides.spot === 'asks' ? spotBook.bid : spotBook.ask;
    const oppSpotQty = sides.spot === 'asks' ? spotBook.bidQty : spotBook.askQty;
    const oppPerpPx = sides.perp === 'asks' ? perpBook.bid : perpBook.ask;
    const oppPerpQty = sides.perp === 'asks' ? perpBook.bidQty : perpBook.askQty;
    const oppQtyUsd = oppSpotPx * oppSpotQty + oppPerpPx * oppPerpQty;
    if (oppQtyUsd > 0) bookPressure = hitQtyUsd / oppQtyUsd;
  }

  return {
    depthScore,
    slippagePct,
    ladderBacked: spotLadder !== null && perpLadder !== null,
    bookPressure,
  };
}

export function assessDataQuality(args: {
  spotStalenessMs: number | null;
  perpStalenessMs: number | null;
  legSkewMs: number | null;
  perpBook: BookTicker | null;
  markPrice: number | null;
  ladderBacked: boolean;
  cfg: BasisConfig;
}): DataQuality {
  const { spotStalenessMs, perpStalenessMs, legSkewMs, perpBook, markPrice, ladderBacked, cfg } = args;
  const suspectReasons: string[] = [];

  // each component maps to 0..1 (1 = pristine)
  const staleComponent = (ms: number | null): number => {
    if (ms === null) {
      suspectReasons.push('leg_never_seen');
      return 0;
    }
    return clamp(1 - ms / cfg.staleMs, 0, 1);
  };
  const spotFresh = staleComponent(spotStalenessMs);
  const perpFresh = staleComponent(perpStalenessMs);

  let skewComponent = 1;
  if (legSkewMs === null) {
    skewComponent = 0.5;
  } else {
    skewComponent = clamp(1 - legSkewMs / cfg.maxLegSkewMs, 0, 1);
    if (legSkewMs > cfg.maxLegSkewMs) suspectReasons.push('leg_timestamp_skew');
  }

  let divergence: number | null = null;
  let divergenceComponent = 0.75; // unknown mark = mild distrust
  if (perpBook && markPrice !== null) {
    const mid = bookMid(perpBook);
    divergence = mid === null ? null : markDivergenceBps(mid, markPrice);
    if (divergence !== null) {
      divergenceComponent = clamp(1 - divergence / cfg.maxMarkDivergenceBps, 0, 1);
      if (divergence > cfg.maxMarkDivergenceBps) suspectReasons.push('mark_book_divergence');
    }
  }

  const ladderComponent = ladderBacked ? 1 : 0.7; // top-of-book-only estimates are softer

  // freshness is the backbone; skew/divergence/ladder modulate it
  const score = clamp(
    Math.min(spotFresh, perpFresh) * (0.5 + 0.5 * skewComponent) * (0.6 + 0.4 * divergenceComponent) * ladderComponent,
    0,
    1,
  );

  return {
    score,
    spotStalenessMs,
    perpStalenessMs,
    legSkewMs,
    markDivergenceBps: divergence,
    suspectReasons,
  };
}
