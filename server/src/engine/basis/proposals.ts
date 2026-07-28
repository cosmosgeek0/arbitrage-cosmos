/**
 * Basis engine — proposal store.
 * Proposals carry correlationId, itemised costs, staged-size metadata (NOTHING
 * here places orders), machine-checkable invalidation specs, and an
 * explainable priority. The store owns the open→updated→expired lifecycle and
 * ledgers every transition.
 *
 * It also owns explicit acceptance: the frozen record of ONE exact proposal
 * revision an acceptor named, plus the single-shot claim that hands it to the
 * handoff lifecycle. Acceptance emits no engine event — the frozen v0
 * EngineEventKind union has no acceptance kind, and reusing a proposal kind
 * would ledger a lie. The acceptance record is the frozen fact this store owns.
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

/** Bounded opaque acceptor label. Never a credential, never an address. */
const ACCEPTOR_MAX_LENGTH = 64;

/**
 * One explicit acceptance of one exact proposal revision, frozen at the moment
 * it is recorded. Nothing downstream may re-derive, refresh, or widen these
 * facts: the acceptor names the proposal, so this store never selects one, and
 * `acceptedNotionalUsd` is a ceiling copied down from the proposal — never a
 * new grant.
 */
export interface BasisProposalAcceptance {
  readonly proposalId: string;
  readonly correlationId: string;
  readonly symbol: string;
  readonly direction: BasisDirection;
  readonly acceptedBy: string;
  readonly acceptedTs: number;
  /** The exact revision (`proposal.updatedTs`) the acceptor saw. */
  readonly acceptedRevisionTs: number;
  readonly acceptedNetEdgePct: number;
  /**
   * USD notional the acceptance was recorded against. It is an acceptance FACT,
   * never a fill bound: base quantities live in a different unit and are never
   * compared with it.
   */
  readonly acceptedNotionalUsd: number;
}

export interface BasisAcceptanceRequest {
  proposalId: string;
  acceptedBy: string;
  acceptedRevisionTs: number;
  acceptedNetEdgePct: number;
  acceptedNotionalUsd: number;
}

export type BasisAcceptanceRefusal =
  | 'UNKNOWN_PROPOSAL'
  | 'PROPOSAL_NOT_OPEN'
  | 'PROPOSAL_EXPIRED'
  | 'ACCEPTOR_INVALID'
  | 'REVISION_MISMATCH'
  | 'EDGE_MISMATCH'
  | 'NOTIONAL_OUT_OF_BOUNDS'
  | 'ACCEPTANCE_CAPACITY';

export type BasisAcceptanceResult =
  | { ok: true; acceptance: BasisProposalAcceptance }
  | { ok: false; refusal: BasisAcceptanceRefusal };

export type BasisAcceptanceConsumeRefusal =
  | 'NOT_ACCEPTED'
  | 'ALREADY_CONSUMED'
  | 'BOUND_TIME_REGRESSION';

export type BasisAcceptanceConsumeResult =
  | { ok: true; acceptance: BasisProposalAcceptance }
  | { ok: false; refusal: BasisAcceptanceConsumeRefusal };

/**
 * The ONLY way an acceptance leaves this store: a single-shot claim addressed
 * by proposal id. A second claim for the same proposal is always refused.
 */
export interface BasisAcceptanceConsumerPort {
  consumeAcceptance(proposalId: string, boundTs: number): BasisAcceptanceConsumeResult;
}

export class BasisProposalStore implements BasisAcceptanceConsumerPort {
  private byId = new Map<string, BasisProposal>();
  private openBySymbol = new Map<string, string>();
  private acceptedById = new Map<string, BasisProposalAcceptance>();
  private consumedAcceptanceIds = new Set<string>();

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
      initiatingPriceTrend: gap.causality.initiatingPriceTrend,
      causalSource: gap.causality.source,
      causalAgeMs: gap.causality.ageMs,
      causalPersistenceEvents: gap.causality.persistenceEvents,
      causalSlopePctPerMin: gap.causality.slopePctPerMin,
      gapEvolution: gap.causality.evolution,
      followerMarket: gap.causality.followerMarket,
      followerConfirmation: gap.causality.followerConfirmation,
      followerSourceTs: gap.causality.followerSourceTs,
      followerSourceSequence: gap.causality.followerSourceSequence,
      lastCausalSourceTs: gap.causality.lastSourceTs,
      lastCausalSourceSequence: gap.causality.lastSourceSequence,
      lastCausalEventSequence: gap.causality.lastAcceptedEventSequence,
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

  /** The frozen acceptance for a proposal, if one was ever recorded. */
  acceptanceFor(proposalId: string): BasisProposalAcceptance | null {
    return this.acceptedById.get(proposalId) ?? null;
  }

  acceptanceConsumed(proposalId: string): boolean {
    return this.consumedAcceptanceIds.has(proposalId);
  }

  /**
   * Record one explicit acceptance of one exact proposal revision. The caller
   * names the proposal and restates what it saw; every restated fact must match
   * the live proposal or the acceptance is refused. This mints no authority:
   * the notional may only be equal to or below the proposal's own suggestion,
   * and an accepted proposal leaves the open set instead of gaining powers.
   */
  accept(request: BasisAcceptanceRequest): BasisAcceptanceResult {
    const p = this.byId.get(request.proposalId);
    if (!p) return { ok: false, refusal: 'UNKNOWN_PROPOSAL' };
    if (p.status !== 'open' && p.status !== 'updated') return { ok: false, refusal: 'PROPOSAL_NOT_OPEN' };
    const now = this.clock.now();
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !Number.isSafeInteger(p.updatedTs) ||
      p.updatedTs < 0 ||
      now < p.updatedTs
    ) {
      throw new RangeError('proposal acceptance clock must be a non-regressing safe-integer timestamp');
    }
    // a proposal past its own TTL is dead whether or not sweep() has run yet
    if (now >= p.invalidationSpec.expiresTs) return { ok: false, refusal: 'PROPOSAL_EXPIRED' };
    const acceptedBy = typeof request.acceptedBy === 'string' ? request.acceptedBy.trim() : '';
    if (acceptedBy.length === 0 || acceptedBy.length > ACCEPTOR_MAX_LENGTH) {
      return { ok: false, refusal: 'ACCEPTOR_INVALID' };
    }
    // accept exactly what was seen: a refresh since the acceptor looked is a
    // different opportunity, never a silently upgraded one
    if (request.acceptedRevisionTs !== p.updatedTs) return { ok: false, refusal: 'REVISION_MISMATCH' };
    if (p.netEdgePct === null || request.acceptedNetEdgePct !== p.netEdgePct) {
      return { ok: false, refusal: 'EDGE_MISMATCH' };
    }
    const notional = request.acceptedNotionalUsd;
    if (
      p.suggestedNotionalUsd === null ||
      !Number.isFinite(notional) ||
      notional <= 0 ||
      notional > p.suggestedNotionalUsd
    ) {
      return { ok: false, refusal: 'NOTIONAL_OUT_OF_BOUNDS' };
    }
    if (this.unconsumedAcceptanceCount() >= this.cfg.maxUniverseSize) {
      return { ok: false, refusal: 'ACCEPTANCE_CAPACITY' };
    }

    const acceptance: BasisProposalAcceptance = Object.freeze({
      proposalId: p.id,
      correlationId: p.correlationId,
      symbol: p.symbol,
      direction: p.direction,
      acceptedBy,
      acceptedTs: now,
      acceptedRevisionTs: request.acceptedRevisionTs,
      acceptedNetEdgePct: request.acceptedNetEdgePct,
      acceptedNotionalUsd: notional,
    });
    p.status = 'approved_manual';
    p.updatedTs = now;
    p.reason = `${p.reason} | accepted`;
    if (this.openBySymbol.get(p.symbol) === p.id) this.openBySymbol.delete(p.symbol);
    this.acceptedById.set(p.id, acceptance);
    return { ok: true, acceptance };
  }

  /**
   * Single-shot claim of one already-accepted proposal (BasisAcceptanceConsumerPort).
   * Exactly one caller can ever win; every later claim is refused, so a handoff
   * can never be opened twice from the same acceptance.
   */
  consumeAcceptance(proposalId: string, boundTs: number): BasisAcceptanceConsumeResult {
    const acceptance = this.acceptedById.get(proposalId);
    if (!acceptance) return { ok: false, refusal: 'NOT_ACCEPTED' };
    if (this.consumedAcceptanceIds.has(proposalId)) return { ok: false, refusal: 'ALREADY_CONSUMED' };
    if (!Number.isSafeInteger(boundTs) || boundTs < acceptance.acceptedTs) {
      return { ok: false, refusal: 'BOUND_TIME_REGRESSION' };
    }
    this.consumedAcceptanceIds.add(proposalId);
    return { ok: true, acceptance };
  }

  expire(id: string, why: string): void {
    const p = this.byId.get(id);
    // 'approved_manual' is terminal here: expiry must never rewrite the facts
    // an acceptance was frozen against.
    if (!p || p.status === 'expired' || p.status === 'rejected' || p.status === 'approved_manual') return;
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

  private unconsumedAcceptanceCount(): number {
    let count = 0;
    for (const id of this.acceptedById.keys()) {
      if (!this.consumedAcceptanceIds.has(id)) count += 1;
    }
    return count;
  }

  private pruneHistory(): void {
    if (this.byId.size <= this.cfg.proposalHistoryKeep) return;
    const closed = [...this.byId.values()]
      .filter((proposal) => proposal.status !== 'open' && proposal.status !== 'updated')
      // an accepted-but-unclaimed proposal is a live claim, not history
      .filter((proposal) => !this.acceptedById.has(proposal.id) || this.consumedAcceptanceIds.has(proposal.id))
      .sort((left, right) => left.updatedTs - right.updatedTs);
    let remove = this.byId.size - this.cfg.proposalHistoryKeep;
    for (const proposal of closed) {
      if (remove <= 0) break;
      this.byId.delete(proposal.id);
      // acceptance bookkeeping never outlives the proposal it describes
      this.acceptedById.delete(proposal.id);
      this.consumedAcceptanceIds.delete(proposal.id);
      remove -= 1;
    }
  }
}
