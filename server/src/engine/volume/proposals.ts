/**
 * Proposal store — ENGINE.md §9 proposal fields + §13 V0 posture.
 * Proposals are structured suggestions with invalidation metadata. There is
 * NO automatic buy/sell: the only exit toward execution is `intentFor()`,
 * which mints a stub for the EXISTING risk gate and refuses outright when the
 * kill switch is on. Every lifecycle step is ledgered with the signal's
 * correlationId.
 */
import type { Clock, Decision, EngineProposal, EventSink, OrderIntentStub } from '../v0/types.js';
import { newCorrelationId } from '../v0/clock.js';
import type { InvalidationReason, InvalidationRule, WakeupSnapshot } from './types.js';
import type { VolumeConfig } from './config.js';
import { makeEvent } from './events.js';

export type IntentResult =
  | { ok: true; intent: OrderIntentStub }
  | { ok: false; reason: 'kill_switch_on' | 'proposal_not_open' | 'proposal_unknown' };

interface StoredProposal extends EngineProposal {
  rule: InvalidationRule;
  invalidatedBy: InvalidationReason | null;
}

export class ProposalStore {
  private proposals = new Map<string, StoredProposal>(); // by id
  private openBySymbol = new Map<string, string>(); // symbol -> open proposal id

  constructor(
    private cfg: VolumeConfig,
    private clock: Clock,
    private sink: EventSink,
  ) {}

  /** Create or refresh the open proposal for a symbol from a proposal decision. */
  upsertFromDecision(d: Decision, f: WakeupSnapshot): EngineProposal {
    const now = this.clock.now();
    const direction = d.evidence.direction === 'short' ? 'short' : 'long';
    const confidence = typeof d.evidence.confidence === 'number' ? d.evidence.confidence : null;
    const refPrice = f.spotAsk ?? f.spotBid ?? 0;
    const existingId = this.openBySymbol.get(d.symbol);
    const existing = existingId ? this.proposals.get(existingId) : undefined;

    if (existing && existing.status !== 'expired' && existing.status !== 'rejected') {
      existing.updatedTs = now;
      existing.status = 'updated';
      existing.confidence = confidence;
      existing.evidence = { ...d.evidence };
      existing.reason = d.humanReason;
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
      evidence: { ...d.evidence },
      rule,
      invalidatedBy: null,
    };
    this.proposals.set(p.id, p);
    this.openBySymbol.set(d.symbol, p.id);
    this.sink.emit(
      makeEvent('proposal_created', now, p.correlationId, `proposal: ${d.humanReason}`, {
        symbol: d.symbol,
        payload: { id: p.id, direction, confidence, invalidation: p.invalidation },
      }),
    );
    return p;
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

  openProposals(): EngineProposal[] {
    return [...this.proposals.values()].filter((p) => p.status === 'open' || p.status === 'updated');
  }

  all(): EngineProposal[] {
    return [...this.proposals.values()];
  }

  byId(id: string): EngineProposal | undefined {
    return this.proposals.get(id);
  }

  openFor(symbol: string): EngineProposal | undefined {
    const id = this.openBySymbol.get(symbol);
    return id ? this.proposals.get(id) : undefined;
  }
}
