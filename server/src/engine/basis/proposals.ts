/**
 * Basis engine — proposal store.
 * Proposals carry correlationId, itemised costs, staged-size metadata (NOTHING
 * here places orders), machine-checkable invalidation specs, and an
 * explainable priority. The store owns the open→updated→expired lifecycle and
 * ledgers every transition.
 */
import type { Clock } from '../v0/types.js';
import { EventEmitter } from './events.js';
import type { BasisConfig } from './config.js';
import type {
  BasisDirection,
  BasisFeatureSnapshot,
  BasisProposal,
  InvalidationSpec,
  PriorityScore,
  StagedSize,
} from './types.js';

let proposalSeq = 0;

export class BasisProposalStore {
  private byId = new Map<string, BasisProposal>();
  private openBySymbol = new Map<string, string>();

  constructor(
    private clock: Clock,
    private cfg: BasisConfig,
    private emitter: EventEmitter,
  ) {}

  /** The single open proposal for a symbol, if any. */
  openFor(symbol: string): BasisProposal | null {
    const id = this.openBySymbol.get(symbol);
    if (!id) return null;
    const proposal = this.byId.get(id);
    if (!proposal || (proposal.status !== 'open' && proposal.status !== 'updated')) {
      this.openBySymbol.delete(symbol);
      return null;
    }
    return proposal;
  }

  all(): BasisProposal[] {
    return [...this.byId.values()].sort((x, y) => y.priority.score - x.priority.score);
  }

  open(): BasisProposal[] {
    const out: BasisProposal[] = [];
    for (const [symbol, id] of this.openBySymbol) {
      const proposal = this.byId.get(id);
      if (proposal && (proposal.status === 'open' || proposal.status === 'updated')) out.push(proposal);
      else this.openBySymbol.delete(symbol);
    }
    return out.sort((left, right) => right.priority.score - left.priority.score);
  }

  get(id: string): BasisProposal | null {
    return this.byId.get(id) ?? null;
  }

  /**
   * Create or refresh the proposal for a symbol from the current snapshot.
   * Same direction → update in place (priority/edge refresh); direction change
   * → expire the old one and open fresh.
   */
  upsert(
    bf: BasisFeatureSnapshot,
    direction: BasisDirection,
    correlationId: string,
    priority: PriorityScore,
    humanReason: string,
  ): BasisProposal {
    const now = this.clock.now();
    const existing = this.openFor(bf.symbol);
    const s = bf.basis;
    const edge = direction === 'long_spot_short_perp' ? s.edge.A : s.edge.B;
    const funding = direction === 'long_spot_short_perp' ? s.funding.A : s.funding.B;
    const gap = direction === 'long_spot_short_perp' ? s.gapA : s.gapB;
    const liq = direction === 'long_spot_short_perp' ? s.liquidity.A : s.liquidity.B;
    const needsBorrow = direction === 'short_spot_long_perp';
    if (!funding.fresh || edge.netEdgePct === null || (needsBorrow && !s.borrowVerdictB.ok)) {
      throw new Error(`cannot create basis proposal from unverified inputs for ${bf.symbol}`);
    }

    const invalidationSpec: InvalidationSpec = {
      gapClosesBelowPct: this.cfg.watchGapPct,
      fundingFlipsAgainst: true,
      maxStaleMs: this.cfg.staleMs,
      spreadAboveBps: this.cfg.maxSpreadBps,
      depthBelowScore: this.cfg.minDepthScore,
      expiresTs: now + this.cfg.proposalTtlMs,
    };

    const stagedSizes: StagedSize[] = this.cfg.stagedSizeFractions.map((fraction, i) => ({
      stage: i + 1,
      fraction,
      notionalUsd: Math.round(this.cfg.suggestedNotionalUsd * fraction * 100) / 100,
    }));

    const evidence: Record<string, number | string | boolean | null> = {
      gapPct: gap.gapPct,
      gapAgeMs: gap.gapAgeMs,
      persistTicks: gap.persistTicks,
      slopePctPerMin: gap.slopePctPerMin,
      stabilityCv: gap.stabilityCv,
      causalQuadrant: gap.causality.quadrant,
      gapTrend: gap.causality.trend,
      initiatingMarket: gap.causality.initiatingMarket,
      initiatingSourceTs: gap.causality.initiatingSourceTs,
      initiatingSourceSequence: gap.causality.initiatingSourceSequence,
      causalEventSequence: gap.causality.acceptedEventSequence,
      fundingCarryPctOverHold: funding.carryPctOverHold,
      fundingFlipRisk: funding.flipRisk,
      expectedHoldMs: funding.expectedHoldMs,
      depthScore: liq.depthScore,
      slippagePct: liq.slippagePct,
      dataQuality: s.dq.score,
      priorityScore: priority.score,
    };

    const confidence = Math.max(0, Math.min(1, priority.score));

    if (existing && existing.direction === direction) {
      existing.updatedTs = now;
      existing.status = 'updated';
      existing.reason = humanReason;
      existing.grossEdgePct = edge.grossEdgePct;
      existing.netEdgePct = edge.netEdgePct;
      existing.fundingAdjPct = edge.fundingAdjPct;
      existing.confidence = confidence;
      existing.priority = priority;
      existing.costBreakdown = edge.costs;
      existing.invalidationSpec = { ...invalidationSpec, expiresTs: existing.invalidationSpec.expiresTs };
      existing.evidence = evidence;
      this.emitter.emit('proposal_updated', existing.correlationId, `proposal refreshed: ${humanReason}`, {
        symbol: bf.symbol,
        payload: { proposalId: existing.id, netEdgePct: edge.netEdgePct, priority: priority.score },
      });
      return existing;
    }

    if (existing) {
      this.expire(existing.id, 'direction_flipped');
    }

    if (this.openBySymbol.size >= this.cfg.maxUniverseSize) {
      throw new RangeError(`basis proposal capacity ${this.cfg.maxUniverseSize} reached`);
    }

    proposalSeq += 1;
    const p: BasisProposal = {
      id: `bp_${now.toString(36)}_${proposalSeq.toString(36)}`,
      correlationId,
      strategy: 'basis',
      symbol: bf.symbol,
      direction,
      createdTs: now,
      updatedTs: now,
      status: 'open',
      reason: humanReason,
      grossEdgePct: edge.grossEdgePct,
      netEdgePct: edge.netEdgePct,
      fundingAdjPct: edge.fundingAdjPct,
      borrowRequired: needsBorrow,
      borrowStatus: needsBorrow ? 'available' : 'not_needed', // reverse only proposes when borrow cleared
      suggestedNotionalUsd: this.cfg.suggestedNotionalUsd,
      confidence,
      invalidation: `gap < ${invalidationSpec.gapClosesBelowPct}% · funding flips against · stale > ${invalidationSpec.maxStaleMs}ms · spread > ${invalidationSpec.spreadAboveBps}bps · depth < ${invalidationSpec.depthBelowScore}`,
      evidence,
      stagedSizes,
      invalidationSpec,
      priority,
      costBreakdown: edge.costs,
    };
    this.byId.set(p.id, p);
    this.openBySymbol.set(p.symbol, p.id);
    this.pruneHistory();
    this.emitter.emit('proposal_created', correlationId, `proposal: ${bf.symbol} ${direction} — ${humanReason}`, {
      symbol: bf.symbol,
      payload: {
        proposalId: p.id,
        direction,
        grossEdgePct: edge.grossEdgePct,
        netEdgePct: edge.netEdgePct,
        costs: { ...edge.costs },
        stagedSizes: stagedSizes.map((x) => x.notionalUsd),
      },
    });
    return p;
  }

  expire(id: string, why: string): void {
    const p = this.byId.get(id);
    if (!p || p.status === 'expired' || p.status === 'rejected') return;
    p.status = 'expired';
    p.updatedTs = this.clock.now();
    p.reason = `${p.reason} | expired: ${why}`;
    if (this.openBySymbol.get(p.symbol) === p.id) this.openBySymbol.delete(p.symbol);
    this.emitter.emit('proposal_expired', p.correlationId, `proposal expired (${why})`, {
      symbol: p.symbol,
      payload: { proposalId: p.id, why },
    });
    this.pruneHistory();
  }

  expireForSymbol(symbol: string, why: string): void {
    const proposal = this.openFor(symbol);
    if (proposal) this.expire(proposal.id, why);
  }

  expireAll(why: string): void {
    for (const proposal of this.open()) this.expire(proposal.id, why);
  }

  retainSymbols(
    symbols: ReadonlySet<string>,
    reasonFor: (symbol: string) => string = () => 'symbol_left_universe',
  ): Array<{ id: string; symbol: string; why: string }> {
    const expired: Array<{ id: string; symbol: string; why: string }> = [];
    for (const proposal of this.open()) {
      if (!symbols.has(proposal.symbol)) {
        const why = reasonFor(proposal.symbol);
        this.expire(proposal.id, why);
        expired.push({ id: proposal.id, symbol: proposal.symbol, why });
      }
    }
    this.pruneHistory();
    return expired;
  }

  reconcileConfigBounds(): void {
    this.pruneHistory();
  }

  /**
   * Enforce invalidation specs against the live snapshot. Returns what expired
   * and why. Called every tick — a proposal that outlives its conditions is a
   * lie on the cockpit.
   */
  sweep(
    snapshotFor: (symbol: string) => BasisFeatureSnapshot | null,
  ): Array<{ id: string; symbol: string; why: string }> {
    const now = this.clock.now();
    const expired: Array<{ id: string; symbol: string; why: string }> = [];
    const kill = (p: BasisProposal, why: string): void => {
      this.expire(p.id, why);
      expired.push({ id: p.id, symbol: p.symbol, why });
    };
    for (const p of this.open()) {
      const spec = p.invalidationSpec;
      if (now >= spec.expiresTs) {
        kill(p, 'ttl_elapsed');
        continue;
      }
      const bf = snapshotFor(p.symbol);
      if (!bf?.basis) {
        kill(p, 'market_data_missing');
        continue;
      }
      const gap = p.direction === 'long_spot_short_perp' ? bf.basis.gapA : bf.basis.gapB;
      const funding = p.direction === 'long_spot_short_perp' ? bf.basis.funding.A : bf.basis.funding.B;
      const liq = p.direction === 'long_spot_short_perp' ? bf.basis.liquidity.A : bf.basis.liquidity.B;

      if (gap.gapPct === null) {
        kill(p, 'book_missing');
      } else if (!funding.fresh || funding.fundingRate === null || funding.carryPctOverHold === null) {
        kill(p, 'funding_stale');
      } else if (p.direction === 'short_spot_long_perp' && !bf.basis.borrowVerdictB.ok) {
        kill(p, 'borrow_invalid');
      } else if (bf.basis.dq.score < this.cfg.minDataQuality) {
        kill(p, 'data_quality_failed');
      } else if (gap.gapPct < spec.gapClosesBelowPct) {
        kill(p, 'gap_closed');
      } else if (
        // same tolerance the scanner proposes under: funding "flips against"
        // when drag exceeds the configured max, not on any negative carry
        spec.fundingFlipsAgainst &&
        funding.carryPctOverHold !== null &&
        funding.carryPctOverHold < -this.cfg.maxFundingDragPct
      ) {
        kill(p, 'funding_flipped_against');
      } else if (
        bf.spotStalenessMs === null ||
        bf.perpStalenessMs === null ||
        bf.spotStalenessMs > spec.maxStaleMs ||
        bf.perpStalenessMs > spec.maxStaleMs
      ) {
        kill(p, 'data_stale');
      } else if (
        bf.spotSpreadBps === null ||
        bf.perpSpreadBps === null ||
        bf.spotSpreadBps > spec.spreadAboveBps ||
        bf.perpSpreadBps > spec.spreadAboveBps
      ) {
        kill(p, 'spread_widened');
      } else if (liq.depthScore === null || liq.depthScore < spec.depthBelowScore) {
        kill(p, 'depth_vanished');
      }
    }
    return expired;
  }

  private pruneHistory(): void {
    if (this.byId.size <= this.cfg.proposalHistoryKeep) return;
    const closed = [...this.byId.values()]
      .filter((proposal) => proposal.status !== 'open' && proposal.status !== 'updated')
      .sort((left, right) => left.updatedTs - right.updatedTs);
    let remove = this.byId.size - this.cfg.proposalHistoryKeep;
    for (const proposal of closed) {
      if (remove <= 0) break;
      this.byId.delete(proposal.id);
      remove -= 1;
    }
  }
}
