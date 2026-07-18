/**
 * Proposal store — ENGINE.md §9 proposal fields + §13 V0 posture.
 * Proposals are structured suggestions with invalidation metadata. There is
 * NO automatic buy/sell: the only exit toward execution is `intentFor()`,
 * which mints a stub for the EXISTING risk gate and refuses outright when the
 * kill switch is on. Every lifecycle step is ledgered with the signal's
 * correlationId.
 */
import type { Clock, Decision, EventSink, OrderIntentStub, RiskVerdictBridge } from '../v0/types.js';
import { newCorrelationId } from '../v0/clock.js';
import type { InvalidationReason, InvalidationRule, VolumeProposal, WakeupSnapshot } from './types.js';
import type { VolumeConfig } from './config.js';
import { boundedEvidence, makeEvent } from './events.js';

export type IntentResult =
  | { ok: true; intent: OrderIntentStub }
  | { ok: false; reason: 'kill_switch_on' | 'proposal_not_open' | 'proposal_unknown' };

interface StoredProposal extends VolumeProposal {
  rule: InvalidationRule;
  invalidatedBy: InvalidationReason | null;
}

const MAX_PROPOSALS = 2_000;

function proposalFingerprint(
  direction: 'long' | 'short',
  confidence: number | null,
  reason: string,
  evidence: Record<string, number | string | boolean | null>,
  baselineVolume: number | null,
  currentVolume1m: number | null,
  tradeCountMultiple: number | null,
): string {
  return JSON.stringify({
    direction,
    confidence,
    reason,
    evidence,
    baselineVolume,
    currentVolume1m,
    tradeCountMultiple,
  });
}

export class ProposalStore {
  private proposals = new Map<string, StoredProposal>(); // by id
  private openBySymbol = new Map<string, string>(); // symbol -> open proposal id
  private fingerprintById = new Map<string, string>();

  constructor(
    private cfg: VolumeConfig,
    private clock: Clock,
    private sink: EventSink,
  ) {}

  /** Create or refresh the open proposal for a symbol from a proposal decision. */
  upsertFromDecision(d: Decision, f: WakeupSnapshot): VolumeProposal {
    const now = this.clock.now();
    const direction = d.evidence.direction === 'short' ? 'short' : 'long';
    const confidence = typeof d.evidence.confidence === 'number' && Number.isFinite(d.evidence.confidence)
      ? Math.max(0, Math.min(1, d.evidence.confidence))
      : null;
    const evidence = boundedEvidence(d.evidence);
    const baselineVolume = Number.isFinite(f.baseline.quotePerMinMedian) && f.baseline.quotePerMinMedian >= 0
      ? f.baseline.quotePerMinMedian : null;
    const currentVolume1m = Number.isFinite(f.windows['60s']?.quoteVolume)
      && (f.windows['60s']?.quoteVolume ?? -1) >= 0
      ? f.windows['60s']!.quoteVolume : null;
    const tradeCountMultiple = typeof d.evidence.tcMult5s === 'number'
      && Number.isFinite(d.evidence.tcMult5s) && d.evidence.tcMult5s >= 0
      ? d.evidence.tcMult5s : null;
    const fingerprint = proposalFingerprint(
      direction,
      confidence,
      d.humanReason,
      evidence,
      baselineVolume,
      currentVolume1m,
      tradeCountMultiple,
    );
    const refPrice = f.spotAsk ?? f.spotBid ?? 0;
    const existingId = this.openBySymbol.get(d.symbol);
    const existing = existingId ? this.proposals.get(existingId) : undefined;

    if (existing && existing.status !== 'expired' && existing.status !== 'rejected') {
      if (this.fingerprintById.get(existing.id) === fingerprint) return existing;
      existing.updatedTs = now;
      existing.status = 'updated';
      existing.confidence = confidence;
      existing.evidence = evidence;
      existing.reason = d.humanReason;
      existing.baselineVolume = baselineVolume;
      existing.currentVolume1m = currentVolume1m;
      existing.tradeCountMultiple = tradeCountMultiple;
      existing.riskResult = null;
      this.fingerprintById.set(existing.id, fingerprint);
      this.sink.emit(
        makeEvent('proposal_updated', now, existing.correlationId, `proposal refreshed: ${d.humanReason}`, {
          symbol: d.symbol,
          payload: { id: existing.id, confidence },
        }),
      );
      return existing;
    }

    const rule: InvalidationRule = {
      volumeNormalizedBelowMultiple: this.cfg.volumeNormalizedBelowMultiple,
      spreadBlownOutBps: this.cfg.spreadBlownOutBps,
      moveExhaustedPct: this.cfg.maxExtendedMovePct,
      referencePrice: refPrice,
    };
    const p: StoredProposal = {
      id: newCorrelationId(this.clock, 'vp'),
      correlationId: d.correlationId,
      strategy: 'volume_spike',
      symbol: d.symbol,
      direction,
      createdTs: now,
      updatedTs: now,
      status: 'open',
      reason: d.humanReason,
      grossEdgePct: null, // wakeup signals carry no basis-style edge estimate
      netEdgePct: null,
      fundingAdjPct: null,
      borrowRequired: false,
      borrowStatus: 'not_needed',
      suggestedNotionalUsd: this.cfg.suggestedNotionalUsd,
      confidence,
      invalidation: `invalid if 60s volume multiple < ${rule.volumeNormalizedBelowMultiple}×, spread > ${rule.spreadBlownOutBps}bps, |move| from ${refPrice} > ${rule.moveExhaustedPct}%, or ${this.cfg.proposalTtlMs / 60000}min TTL`,
      evidence,
      baselineVolume,
      currentVolume1m,
      tradeCountMultiple,
      riskResult: null,
      rule,
      invalidatedBy: null,
    };
    this.makeRoomForProposal();
    this.proposals.set(p.id, p);
    this.fingerprintById.set(p.id, fingerprint);
    this.openBySymbol.set(d.symbol, p.id);
    this.sink.emit(
      makeEvent('proposal_created', now, p.correlationId, `proposal: ${d.humanReason}`, {
        symbol: d.symbol,
        payload: { id: p.id, direction, confidence, invalidation: p.invalidation },
      }),
    );
    return p;
  }

  /** Expire proposals whose symbols left the configured universe. */
  reconcileSymbols(symbols: ReadonlySet<string>): void {
    const now = this.clock.now();
    for (const [symbol, id] of this.openBySymbol) {
      if (symbols.has(symbol)) continue;
      const proposal = this.proposals.get(id);
      this.openBySymbol.delete(symbol);
      if (!proposal || (proposal.status !== 'open' && proposal.status !== 'updated')) continue;
      proposal.status = 'expired';
      proposal.updatedTs = now;
      proposal.invalidatedBy = 'universe_removed';
      this.sink.emit(
        makeEvent('proposal_expired', now, proposal.correlationId, 'proposal invalidated: universe_removed', {
          symbol,
          payload: { id, invalidatedBy: 'universe_removed' },
        }),
      );
    }
    this.pruneTerminal(MAX_PROPOSALS);
  }

  private pruneTerminal(targetSize: number): void {
    if (this.proposals.size <= targetSize) return;
    const removable = [...this.proposals.values()]
      .filter((proposal) => proposal.status !== 'open' && proposal.status !== 'updated')
      .sort((left, right) => left.updatedTs - right.updatedTs);
    for (const proposal of removable) {
      if (this.proposals.size <= targetSize) break;
      this.proposals.delete(proposal.id);
      this.fingerprintById.delete(proposal.id);
    }
  }

  private makeRoomForProposal(): void {
    this.pruneTerminal(MAX_PROPOSALS - 1);
    if (this.proposals.size < MAX_PROPOSALS) return;
    let oldest: StoredProposal | null = null;
    for (const proposal of this.proposals.values()) {
      if (!oldest || proposal.updatedTs < oldest.updatedTs) oldest = proposal;
    }
    if (!oldest) return;
    oldest.status = 'expired';
    oldest.updatedTs = this.clock.now();
    oldest.invalidatedBy = 'capacity_pruned';
    if (this.openBySymbol.get(oldest.symbol) === oldest.id) this.openBySymbol.delete(oldest.symbol);
    this.proposals.delete(oldest.id);
    this.fingerprintById.delete(oldest.id);
    this.sink.emit(
      makeEvent('proposal_expired', this.clock.now(), oldest.correlationId, 'proposal invalidated: capacity_pruned', {
        symbol: oldest.symbol,
        payload: { id: oldest.id, invalidatedBy: 'capacity_pruned', cap: MAX_PROPOSALS },
      }),
    );
  }

  /** Re-check invalidation conditions for a symbol's open proposal. */
  refresh(f: WakeupSnapshot): void {
    const id = this.openBySymbol.get(f.symbol);
    if (!id) return;
    const p = this.proposals.get(id);
    if (!p || (p.status !== 'open' && p.status !== 'updated')) return;
    const now = this.clock.now();

    let why: InvalidationReason | null = null;
    if (now - p.createdTs > this.cfg.proposalTtlMs) why = 'ttl_expired';
    const m60 = f.volumeMultiple['60s'];
    if (!why && m60 !== null && m60 !== undefined && m60 < p.rule.volumeNormalizedBelowMultiple)
      why = 'volume_normalized';
    if (!why && f.spotSpreadBps !== null && f.spotSpreadBps >= p.rule.spreadBlownOutBps)
      why = 'spread_blown_out';
    const price = f.spotAsk ?? f.spotBid;
    if (!why && price !== null && p.rule.referencePrice > 0) {
      const movePct = Math.abs((price - p.rule.referencePrice) / p.rule.referencePrice) * 100;
      if (movePct >= p.rule.moveExhaustedPct) why = 'move_exhausted';
    }
    if (!why) return;

    p.status = 'expired';
    p.updatedTs = now;
    p.invalidatedBy = why;
    this.openBySymbol.delete(f.symbol);
    this.sink.emit(
      makeEvent('proposal_expired', now, p.correlationId, `proposal invalidated: ${why}`, {
        symbol: f.symbol,
        payload: { id: p.id, invalidatedBy: why },
      }),
    );
  }

  /**
   * The ONLY path toward execution: mint a stub for the existing risk gate.
   * Kill switch blocks it here regardless of what upstream believed.
   */
  intentFor(proposalId: string, killSwitch: boolean): IntentResult {
    const p = this.proposals.get(proposalId);
    if (!p) return { ok: false, reason: 'proposal_unknown' };
    if (p.status !== 'open' && p.status !== 'updated') return { ok: false, reason: 'proposal_not_open' };
    if (killSwitch) {
      p.riskResult = Object.freeze({
        allowed: false,
        reasons: Object.freeze(['kill_switch_on']),
        correlationId: p.correlationId,
        ts: this.clock.now(),
      });
      this.sink.emit(
        makeEvent('risk_rejected', this.clock.now(), p.correlationId, 'intent blocked: kill switch is ON', {
          symbol: p.symbol,
          rejectCode: 'kill_switch_on',
          payload: { proposalId: p.id },
        }),
      );
      return { ok: false, reason: 'kill_switch_on' };
    }
    return {
      ok: true,
      intent: {
        correlationId: p.correlationId,
        proposalId: p.id,
        symbol: p.symbol,
        side: p.direction === 'short' ? 'SELL' : 'BUY',
        notionalUsd: p.suggestedNotionalUsd ?? this.cfg.suggestedNotionalUsd,
        source: 'proposal',
      },
    };
  }

  /** Attach the canonical risk bridge result without recomputing risk. */
  recordRiskResult(proposalId: string, verdict: Readonly<RiskVerdictBridge>): boolean {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || (proposal.status !== 'open' && proposal.status !== 'updated')) return false;
    if (
      !verdict
      || typeof verdict.allowed !== 'boolean'
      || verdict.correlationId !== proposal.correlationId
      || !Number.isSafeInteger(verdict.ts)
      || verdict.ts < 0
      || !Array.isArray(verdict.reasons)
      || verdict.reasons.some((reason) => typeof reason !== 'string' || reason.length === 0 || reason.length > 256)
    ) return false;
    proposal.riskResult = Object.freeze({
      allowed: verdict.allowed,
      reasons: Object.freeze([...verdict.reasons]),
      correlationId: verdict.correlationId,
      ts: verdict.ts,
    });
    return true;
  }

  openProposals(): VolumeProposal[] {
    return [...this.proposals.values()].filter((p) => p.status === 'open' || p.status === 'updated');
  }

  all(): VolumeProposal[] {
    return [...this.proposals.values()];
  }

  byId(id: string): VolumeProposal | undefined {
    return this.proposals.get(id);
  }

  openFor(symbol: string): VolumeProposal | undefined {
    const id = this.openBySymbol.get(symbol);
    return id ? this.proposals.get(id) : undefined;
  }
}
