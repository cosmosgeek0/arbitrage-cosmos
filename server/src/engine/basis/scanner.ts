/**
 * Basis engine — the go/no-go decision core (implements the v0 Scanner
 * contract). Pure: features + context in, one Decision out. Guard order is
 * deliberate and the FIRST failing guard names the reject — reject codes are
 * the frozen v0 set, never invented per run.
 *
 * Guard ladder per direction:
 *   structure (spot/perp/book present) → data quality (stale/skew/divergence)
 *   → gap exists → spread → depth → gross vs fees → funding drag → borrow (B)
 *   → gap stability → net edge threshold → persistence → PROPOSAL
 * Kill switch converts a would-be proposal into a named reject at the end —
 * the engine keeps seeing, it just cannot arm.
 */
import type { Decision, DecisionKind, RejectCode, ScanContext, Scanner, StrategyId } from '../v0/types.js';
import type { BasisConfig } from './config.js';
import type { BasisDirection, BasisFeatureSnapshot } from './types.js';

interface DirectionVerdict {
  direction: BasisDirection;
  kind: DecisionKind;
  rejectCode: RejectCode | null;
  human: string;
  gapPct: number | null;
  netEdgePct: number | null;
}

const KIND_RANK: Record<DecisionKind, number> = {
  proposal: 5,
  focus: 4,
  watch: 3,
  reject: 2,
  ignore: 1,
};

export class BasisScanner implements Scanner {
  readonly strategy: StrategyId = 'basis';

  constructor(private cfg: BasisConfig) {}

  evaluate(f: import('../v0/types.js').FeatureSnapshot, ctx: ScanContext): Decision {
    const bf = f as BasisFeatureSnapshot;
    const corr = ''; // engine stamps the signal-path correlationId; scanner stays pure

    if (!bf.basis) {
      return this.decision(bf, ctx, {
        direction: 'long_spot_short_perp',
        kind: 'ignore',
        rejectCode: null,
        human: 'no basis signals on snapshot',
        gapPct: null,
        netEdgePct: null,
      }, corr);
    }

    if (!ctx.symbolAllowed) {
      return this.decision(bf, ctx, {
        direction: 'long_spot_short_perp',
        kind: 'reject',
        rejectCode: 'symbol_blocked',
        human: 'symbol not on allowlist / on blocklist',
        gapPct: null,
        netEdgePct: null,
      }, corr);
    }

    const a = this.evaluateDirection(bf, 'long_spot_short_perp', ctx);
    const b = this.evaluateDirection(bf, 'short_spot_long_perp', ctx);
    let best = this.pick(a, b);

    // kill switch: observation continues, arming does not
    if (best.kind === 'proposal' && ctx.killSwitch) {
      best = {
        ...best,
        kind: 'reject',
        rejectCode: 'kill_switch_on',
        human: `kill switch on — would have proposed ${best.direction} (net ${best.netEdgePct?.toFixed(3)}%)`,
      };
    }

    return this.decision(bf, ctx, best, corr);
  }

  /** Primary = economically bigger gap; actionable kinds outrank rejects. */
  private pick(a: DirectionVerdict, b: DirectionVerdict): DirectionVerdict {
    if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) {
      return KIND_RANK[a.kind] > KIND_RANK[b.kind] ? a : b;
    }
    const ga = a.gapPct ?? -Infinity;
    const gb = b.gapPct ?? -Infinity;
    return ga >= gb ? a : b;
  }

  private evaluateDirection(
    bf: BasisFeatureSnapshot,
    direction: BasisDirection,
    ctx: ScanContext,
  ): DirectionVerdict {
    const cfg = this.cfg;
    const s = bf.basis;
    const gap = direction === 'long_spot_short_perp' ? s.gapA : s.gapB;
    const funding = direction === 'long_spot_short_perp' ? s.funding.A : s.funding.B;
    const liq = direction === 'long_spot_short_perp' ? s.liquidity.A : s.liquidity.B;
    const edge = direction === 'long_spot_short_perp' ? s.edge.A : s.edge.B;
    const v = (kind: DecisionKind, rejectCode: RejectCode | null, human: string): DirectionVerdict => ({
      direction,
      kind,
      rejectCode,
      human,
      gapPct: gap.gapPct,
      netEdgePct: edge.netEdgePct,
    });

    // --- structure ---
    if (bf.spotBid === null || bf.spotAsk === null) {
      return v('reject', 'spot_missing', 'no spot book for symbol');
    }
    if (bf.perpBid === null || bf.perpAsk === null) {
      return v('reject', 'perp_missing', 'no perp book for symbol');
    }

    // --- data quality: staleness, cross-leg skew, mark divergence composite ---
    if (
      bf.spotStalenessMs === null ||
      bf.perpStalenessMs === null ||
      bf.spotStalenessMs > cfg.staleMs ||
      bf.perpStalenessMs > cfg.staleMs
    ) {
      return v(
        'reject',
        'data_stale',
        `book stale (spot ${bf.spotStalenessMs}ms, perp ${bf.perpStalenessMs}ms > ${cfg.staleMs}ms)`,
      );
    }
    if (s.dq.legSkewMs !== null && s.dq.legSkewMs > cfg.maxLegSkewMs) {
      return v('reject', 'data_stale', `cross-leg timestamp skew ${s.dq.legSkewMs}ms — gap is fiction`);
    }
    if (s.dq.score < cfg.minDataQuality) {
      return v(
        'reject',
        'data_stale',
        `data quality ${s.dq.score.toFixed(2)} < ${cfg.minDataQuality} (${s.dq.suspectReasons.join(',') || 'composite'})`,
      );
    }
    if (!funding.fresh || funding.fundingRate === null || funding.carryPctOverHold === null) {
      return v(
        'reject',
        'data_stale',
        `funding unavailable or stale (${funding.stalenessMs ?? 'never'}ms > ${cfg.fundingStaleMs}ms)`,
      );
    }

    // --- gap exists? ---
    if (gap.gapPct === null) {
      return v('reject', 'book_missing', 'executable gap not computable from books');
    }
    if (gap.gapPct < cfg.watchGapPct) {
      return v('ignore', null, `gap ${gap.gapPct.toFixed(3)}% below watch threshold ${cfg.watchGapPct}%`);
    }

    // --- spread ---
    if (
      bf.spotSpreadBps === null ||
      bf.perpSpreadBps === null ||
      bf.spotSpreadBps > cfg.maxSpreadBps ||
      bf.perpSpreadBps > cfg.maxSpreadBps
    ) {
      return v(
        'reject',
        'spread_too_wide',
        `spread spot ${bf.spotSpreadBps?.toFixed(1)}bps / perp ${bf.perpSpreadBps?.toFixed(1)}bps > ${cfg.maxSpreadBps}bps`,
      );
    }

    // --- depth at intended size ---
    if (liq.depthScore === null || liq.depthScore < cfg.minDepthScore) {
      return v(
        'reject',
        'depth_too_thin',
        `depth score ${liq.depthScore?.toFixed(2) ?? 'unknown'} < ${cfg.minDepthScore} at $${cfg.suggestedNotionalUsd}`,
      );
    }

    // --- economics: fees first (structural), then funding, then threshold ---
    const feesPlusSlippage = edge.costs.feesPct + edge.costs.slippagePct;
    if (gap.gapPct <= feesPlusSlippage) {
      return v(
        'reject',
        'edge_below_fees',
        `gross ${gap.gapPct.toFixed(3)}% ≤ fees+slippage ${feesPlusSlippage.toFixed(3)}%`,
      );
    }
    if (edge.costs.fundingDragPct > cfg.maxFundingDragPct) {
      return v(
        'reject',
        'funding_against_trade',
        `funding drags ${edge.costs.fundingDragPct.toFixed(3)}% over expected hold (max ${cfg.maxFundingDragPct}%)`,
      );
    }

    // --- borrow preflight (reverse basis only): ctx status is the coarse
    // gate, the feature-level verdict adds size/cost checks ---
    if (direction === 'short_spot_long_perp') {
      if (ctx.borrowStatus === 'unknown') {
        return v('reject', 'borrow_unknown', 'borrow status unknown — reverse basis not executable');
      }
      if (ctx.borrowStatus === 'unavailable') {
        return v('reject', 'borrow_unavailable', 'borrow unavailable for base asset');
      }
      const verdict = s.borrowVerdictB;
      if (!verdict.ok) {
        return v('reject', verdict.rejectCode ?? 'borrow_unknown', verdict.human);
      }
    }

    // --- gap stability: a flickering gap is book noise ---
    if (gap.stabilityCv !== null && gap.stabilityCv > cfg.maxGapCv && gap.persistTicks < cfg.persistTicks) {
      return v(
        'reject',
        'gap_not_persistent',
        `gap unstable (CV ${gap.stabilityCv.toFixed(2)} > ${cfg.maxGapCv})`,
      );
    }

    // --- net edge threshold ---
    if (edge.netEdgePct === null || edge.netEdgePct < cfg.minNetBasisPct) {
      return v(
        'reject',
        'edge_below_threshold',
        `net ${edge.netEdgePct?.toFixed(3) ?? 'n/a'}% < required ${cfg.minNetBasisPct}%`,
      );
    }

    // --- persistence: survive N ticks before arming ---
    if (gap.persistTicks < cfg.persistTicks) {
      const kind: DecisionKind = gap.gapPct >= cfg.focusGapPct ? 'focus' : 'watch';
      return v(
        kind,
        null,
        `gap ${gap.gapPct.toFixed(3)}% persisting ${gap.persistTicks}/${cfg.persistTicks} ticks`,
      );
    }

    return v(
      'proposal',
      null,
      `net edge ${edge.netEdgePct.toFixed(3)}% after ${edge.costs.totalPct.toFixed(3)}% costs, persisted ${gap.persistTicks} ticks`,
    );
  }

  /** Assemble the full §8 decision record with decisive evidence. */
  private decision(
    bf: BasisFeatureSnapshot,
    ctx: ScanContext,
    verdict: DirectionVerdict,
    correlationId: string,
  ): Decision {
    const s = bf.basis;
    const gap = verdict.direction === 'long_spot_short_perp' ? s?.gapA : s?.gapB;
    const funding = verdict.direction === 'long_spot_short_perp' ? s?.funding.A : s?.funding.B;
    const liq = verdict.direction === 'long_spot_short_perp' ? s?.liquidity.A : s?.liquidity.B;
    const edge = verdict.direction === 'long_spot_short_perp' ? s?.edge.A : s?.edge.B;
    const midBasisPct =
      bf.spotBid !== null && bf.spotAsk !== null && bf.perpBid !== null && bf.perpAsk !== null
        ? (((bf.perpBid + bf.perpAsk) / 2 - (bf.spotBid + bf.spotAsk) / 2) / ((bf.spotBid + bf.spotAsk) / 2)) * 100
        : null;

    return {
      symbol: bf.symbol,
      ts: bf.ts,
      strategy: this.strategy,
      kind: verdict.kind,
      rejectCode: verdict.rejectCode,
      humanReason: verdict.human,
      correlationId,
      evidence: {
        direction: verdict.direction,
        spotBid: bf.spotBid,
        spotAsk: bf.spotAsk,
        perpBid: bf.perpBid,
        perpAsk: bf.perpAsk,
        markPrice: bf.markPrice,
        rawMidBasisPct: midBasisPct,
        gapLongSpotPct: bf.basisLongSpotPct,
        gapShortSpotPct: bf.basisShortSpotPct,
        gapAgeMs: gap?.gapAgeMs ?? null,
        gapPersistTicks: gap?.persistTicks ?? null,
        gapSlopePctPerMin: gap?.slopePctPerMin ?? null,
        gapStabilityCv: gap?.stabilityCv ?? null,
        gapCausalQuadrant: gap?.causality.quadrant ?? 'UNKNOWN',
        gapTrend: gap?.causality.trend ?? 'UNKNOWN',
        gapInitiatingMarket: gap?.causality.initiatingMarket ?? 'UNKNOWN',
        gapInitiatingSourceTs: gap?.causality.initiatingSourceTs ?? null,
        gapInitiatingSourceSequence: gap?.causality.initiatingSourceSequence ?? null,
        gapCausalEventSequence: gap?.causality.acceptedEventSequence ?? null,
        gapInitiatingPriceTrend: gap?.causality.initiatingPriceTrend ?? 'UNKNOWN',
        gapCausalSource: gap?.causality.source ?? 'UNKNOWN',
        gapCausalAgeMs: gap?.causality.ageMs ?? null,
        gapCausalPersistenceEvents: gap?.causality.persistenceEvents ?? 0,
        gapCausalSlopePctPerMin: gap?.causality.slopePctPerMin ?? null,
        gapEvolution: gap?.causality.evolution ?? 'UNKNOWN',
        gapFollowerMarket: gap?.causality.followerMarket ?? 'UNKNOWN',
        gapFollowerConfirmation: gap?.causality.followerConfirmation ?? 'UNKNOWN',
        gapFollowerSourceTs: gap?.causality.followerSourceTs ?? null,
        gapFollowerSourceSequence: gap?.causality.followerSourceSequence ?? null,
        gapLastCausalSourceTs: gap?.causality.lastSourceTs ?? null,
        gapLastCausalSourceSequence: gap?.causality.lastSourceSequence ?? null,
        gapLastCausalEventSequence: gap?.causality.lastAcceptedEventSequence ?? null,
        fundingRate: bf.fundingRate,
        msToFunding: funding?.msToFunding ?? null,
        fundingCarryPctOverHold: funding?.carryPctOverHold ?? null,
        fundingFlipRisk: funding?.flipRisk ?? null,
        expectedHoldMs: funding?.expectedHoldMs ?? null,
        spotSpreadBps: bf.spotSpreadBps,
        perpSpreadBps: bf.perpSpreadBps,
        depthScore: liq?.depthScore ?? null,
        slippagePct: liq?.slippagePct ?? null,
        bookPressure: liq?.bookPressure ?? null,
        dataQuality: s?.dq.score ?? null,
        legSkewMs: s?.dq.legSkewMs ?? null,
        markDivergenceBps: s?.dq.markDivergenceBps ?? null,
        spotStalenessMs: bf.spotStalenessMs,
        perpStalenessMs: bf.perpStalenessMs,
        fundingStalenessMs: funding?.stalenessMs ?? null,
        borrowStatus: ctx.borrowStatus,
        grossEdgePct: edge?.grossEdgePct ?? null,
        feesPct: edge?.costs.feesPct ?? null,
        fundingDragPct: edge?.costs.fundingDragPct ?? null,
        borrowCostPct: edge?.costs.borrowCostPct ?? null,
        netEdgePct: edge?.netEdgePct ?? null,
        killSwitch: ctx.killSwitch,
      },
    };
  }
}
