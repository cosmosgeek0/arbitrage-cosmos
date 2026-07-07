/**
 * Basis engine — feature builder. Turns raw market state into one
 * BasisFeatureSnapshot per symbol per tick: v0 FeatureSnapshot fields filled
 * where basis cares, plus the full BasisSignals extension (gaps both
 * directions, funding, liquidity, borrow, data quality, itemised edge).
 * Pure assembly — every model lives in its own module.
 */
import type { FeatureSource, FeatureSnapshot } from '../v0/types.js';
import type { Clock } from '../v0/types.js';
import { preflightBorrow } from './borrow.js';
import { estimateEdge } from './edge.js';
import { buildFundingContext, expectedHoldMs } from './funding.js';
import { GapTracker } from './gapTracker.js';
import { assessDataQuality, assessLiquidity } from './liquidity.js';
import { gapLongSpotShortPerpPct, gapShortSpotLongPerpPct, spreadBps } from './math.js';
import { BasisMarketState } from './marketState.js';
import type { BasisConfig } from './config.js';
import type { BasisFeatureSnapshot } from './types.js';

export class BasisFeatureBuilder implements FeatureSource {
  constructor(
    private market: BasisMarketState,
    private gaps: GapTracker,
    private clock: Clock,
    private cfg: BasisConfig,
  ) {}

  symbols(): string[] {
    return this.market.symbols();
  }

  snapshot(symbol: string): BasisFeatureSnapshot | null {
    return this.build(symbol, false);
  }

  /**
   * Build the snapshot for the current tick. `observe=true` feeds the gap
   * tracker (exactly once per engine tick); reads elsewhere pass false.
   */
  build(symbol: string, observe: boolean): BasisFeatureSnapshot | null {
    const now = this.clock.now();
    const spot = this.market.spotBook(symbol);
    const perp = this.market.perpBook(symbol);
    const mark = this.market.markFunding(symbol);
    const spotDepth = this.market.spotDepth(symbol);
    const perpDepth = this.market.perpDepth(symbol);
    const meta = this.market.meta(symbol);
    if (!spot && !perp && !mark) return null;

    // --- executable gaps, both directions, from real bid/ask only ---
    const rawGapA = spot && perp ? gapLongSpotShortPerpPct(spot.ask, perp.bid) : null;
    const rawGapB = spot && perp ? gapShortSpotLongPerpPct(spot.bid, perp.ask) : null;
    const gapA = observe
      ? this.gaps.observe(symbol, 'long_spot_short_perp', rawGapA)
      : this.gaps.state(symbol, 'long_spot_short_perp', rawGapA);
    const gapB = observe
      ? this.gaps.observe(symbol, 'short_spot_long_perp', rawGapB)
      : this.gaps.state(symbol, 'short_spot_long_perp', rawGapB);

    // --- funding, per direction (sign flips meaning) ---
    const history = this.market.fundingHistory(symbol);
    const fundingA = buildFundingContext(mark, history, 'long_spot_short_perp', gapA, now, this.cfg);
    const fundingB = buildFundingContext(mark, history, 'short_spot_long_perp', gapB, now, this.cfg);

    // --- liquidity at the intended size, per direction ---
    const notional = this.cfg.suggestedNotionalUsd;
    const liqA = assessLiquidity('long_spot_short_perp', spot, perp, spotDepth, perpDepth, notional, this.cfg);
    const liqB = assessLiquidity('short_spot_long_perp', spot, perp, spotDepth, perpDepth, notional, this.cfg);

    // --- borrow preflight (only direction B needs it) ---
    const borrow = this.market.borrowForSymbol(symbol);
    const refPrice = spot?.bid ?? perp?.ask ?? null;
    const borrowVerdictB = preflightBorrow(
      true,
      borrow,
      notional,
      refPrice,
      expectedHoldMs(gapB, this.cfg),
      this.cfg,
    );

    // --- data quality (shared across directions) ---
    const spotStale = this.market.spotStalenessMs(symbol);
    const perpStale = this.market.perpStalenessMs(symbol);
    const dq = assessDataQuality({
      spotStalenessMs: spotStale,
      perpStalenessMs: perpStale,
      legSkewMs: this.market.legSkewMs(symbol),
      perpBook: perp,
      markPrice: mark?.markPrice ?? null,
      ladderBacked: liqA.ladderBacked,
      cfg: this.cfg,
    });

    // --- itemised edge per direction ---
    const edgeA = estimateEdge('long_spot_short_perp', gapA, fundingA, liqA, 0, this.cfg);
    const edgeB = estimateEdge(
      'short_spot_long_perp',
      gapB,
      fundingB,
      liqB,
      borrowVerdictB.costPctOverHold,
      this.cfg,
    );

    const base: FeatureSnapshot = {
      symbol,
      ts: now,
      spotBid: spot?.bid ?? null,
      spotAsk: spot?.ask ?? null,
      perpBid: perp?.bid ?? null,
      perpAsk: perp?.ask ?? null,
      markPrice: mark?.markPrice ?? null,
      fundingRate: mark?.fundingRate ?? null,
      spotSpreadBps: spot ? spreadBps(spot.bid, spot.ask) : null,
      perpSpreadBps: perp ? spreadBps(perp.bid, perp.ask) : null,
      spotStalenessMs: spotStale,
      perpStalenessMs: perpStale,
      basisLongSpotPct: rawGapA,
      basisShortSpotPct: rawGapB,
      basisSlopePctPerMin: gapA.slopePctPerMin ?? gapB.slopePctPerMin,
      windows: {}, // volume windows belong to the volume lane; basis leaves them empty
      volumeMultiple: {},
      tradeCountMultiple: {},
      baselineReady: gapA.samples >= 3 || gapB.samples >= 3,
      depthScore: liqA.depthScore ?? liqB.depthScore,
    };

    return {
      ...base,
      basis: {
        gapA,
        gapB,
        funding: { A: fundingA, B: fundingB },
        liquidity: { A: liqA, B: liqB },
        dq,
        borrow: meta ? borrow : null,
        borrowVerdictB,
        edge: { A: edgeA, B: edgeB },
      },
    };
  }
}
