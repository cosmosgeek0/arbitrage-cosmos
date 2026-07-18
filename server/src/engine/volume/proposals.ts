/**
 * Proposal store — ENGINE.md §9 proposal fields + §13 V0 posture.
 * Proposals are structured suggestions with invalidation metadata. There is
 * NO automatic buy/sell: the only exit toward execution is `intentFor()`,
 * which mints a stub for the canonical Foundation risk evaluator and refuses
 * outright when the kill switch is on. Every lifecycle step is ledgered with
 * the signal's correlationId.
 */
import { createHash } from 'node:crypto';
import type { Clock, Decision, EventSink, OrderIntentStub } from '../v0/types.js';
import { newCorrelationId } from '../v0/clock.js';
import {
  canonicalJson,
  deriveCanonicalProposalId,
  derivePlanId,
  deriveSourceProposalId,
  isValidUtcMillis,
  stableHash128Hex,
  validateRiskCheck,
} from '../../foundation/contracts/index.js';
import type {
  InvalidationReason,
  InvalidationRule,
  VolumeFoundationRiskAttachmentInput,
  VolumeFoundationRiskResult,
  VolumeProposal,
  VolumeProposalRiskCut,
  WakeupSnapshot,
} from './types.js';
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
const VERDICT_KEYS = Object.freeze([
  'allowed',
  'blockingCodes',
  'checks',
  'evaluatedAt',
  'expiresAt',
]);
const RISK_CHECK_KEYS = Object.freeze([
  'blocking',
  'code',
  'detail',
  'evidenceTimestamp',
  'limit',
  'observed',
  'status',
]);

function isExactPlainDataRecord(
  input: unknown,
  expectedKeys: readonly string[],
): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  try {
    if (Object.getPrototypeOf(input) !== Object.prototype
        || Object.getOwnPropertySymbols(input).length !== 0) return false;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Object.keys(descriptors).sort();
    if (keys.length !== expectedKeys.length
        || keys.some((key, index) => key !== expectedKeys[index])) return false;
    return keys.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined
        && 'value' in descriptor
        && descriptor.enumerable === true;
    });
  } catch {
    return false;
  }
}

function isDensePlainArray(input: unknown): input is readonly unknown[] {
  if (!Array.isArray(input)) return false;
  try {
    if (Object.getPrototypeOf(input) !== Array.prototype
        || Object.getOwnPropertySymbols(input).length !== 0) return false;
    const names = Object.getOwnPropertyNames(input);
    if (names.length !== input.length + 1 || !names.includes('length')) return false;
    for (let index = 0; index < input.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function sha256(namespace: string, value: unknown): string {
  return createHash('sha256').update(`${namespace}|${canonicalJson(value)}`).digest('hex');
}

function configurationRevision(config: Readonly<VolumeConfig>): string {
  return `vcfg_${sha256('volumeConfig.v1', config)}`;
}

function proposalFingerprint(
  symbol: string,
  correlationId: string,
  featureObservedAtMs: number,
  configRevision: string,
  direction: 'long' | 'short',
  confidence: number | null,
  reason: string,
  evidence: Record<string, number | string | boolean | null>,
  baselineVolume: number | null,
  currentVolume1m: number | null,
  tradeCountMultiple: number | null,
): string {
  return JSON.stringify({
    symbol,
    correlationId,
    featureObservedAtMs,
    configRevision,
    direction,
    confidence,
    reason,
    evidence,
    baselineVolume,
    currentVolume1m,
    tradeCountMultiple,
  });
}

function proposalDigest(input: Readonly<{
  id: string;
  correlationId: string;
  proposalRevision: number;
  configurationRevision: string;
  symbol: string;
  direction: 'long' | 'short';
  createdTs: number;
  updatedTs: number;
  featureObservedAtMs: number;
  expiresAtMs: number;
  status: string;
  reason: string;
  grossEdgePct: number | null;
  netEdgePct: number | null;
  fundingAdjPct: number | null;
  borrowRequired: boolean;
  borrowStatus: string;
  suggestedNotionalUsd: number | null;
  confidence: number | null;
  invalidation: string | null;
  rule: Readonly<InvalidationRule>;
  evidence: Readonly<Record<string, number | string | boolean | null>>;
  baselineVolume: number | null;
  currentVolume1m: number | null;
  tradeCountMultiple: number | null;
}>): string {
  return `vprop_${sha256('volumeProposal.v2', {
    id: input.id,
    correlationId: input.correlationId,
    proposalRevision: input.proposalRevision,
    configurationRevision: input.configurationRevision,
    symbol: input.symbol,
    direction: input.direction,
    createdTs: input.createdTs,
    updatedTs: input.updatedTs,
    featureObservedAtMs: input.featureObservedAtMs,
    expiresAtMs: input.expiresAtMs,
    status: input.status,
    reason: input.reason,
    grossEdgePct: input.grossEdgePct,
    netEdgePct: input.netEdgePct,
    fundingAdjPct: input.fundingAdjPct,
    borrowRequired: input.borrowRequired,
    borrowStatus: input.borrowStatus,
    suggestedNotionalUsd: input.suggestedNotionalUsd,
    confidence: input.confidence,
    invalidation: input.invalidation,
    rule: input.rule,
    evidence: input.evidence,
    baselineVolume: input.baselineVolume,
    currentVolume1m: input.currentVolume1m,
    tradeCountMultiple: input.tradeCountMultiple,
  })}`;
}

function verdictDigest(input: Readonly<VolumeFoundationRiskAttachmentInput>['verdict']): string {
  return `riskv_${stableHash128Hex(`foundationRiskVerdict|${canonicalJson(input)}`)}`;
}

function frozenEvidence(
  input: Record<string, number | string | boolean | null>,
): Readonly<Record<string, number | string | boolean | null>> {
  return Object.freeze({ ...input });
}

function projectRiskResult(
  result: Readonly<VolumeFoundationRiskResult> | null,
): Readonly<VolumeFoundationRiskResult> | null {
  if (result === null) return null;
  return Object.freeze({
    ...result,
    checks: Object.freeze(result.checks.map((check) => Object.freeze({
      code: check.code,
      status: check.status,
      blocking: check.blocking,
      detail: check.detail,
      observed: check.observed,
      limit: check.limit,
      evidenceTimestamp: check.evidenceTimestamp,
    }))),
    blockingCodes: Object.freeze([...result.blockingCodes]),
  });
}

function projectProposal(proposal: Readonly<StoredProposal>): Readonly<VolumeProposal> {
  return Object.freeze({
    id: proposal.id,
    correlationId: proposal.correlationId,
    strategy: proposal.strategy,
    symbol: proposal.symbol,
    direction: proposal.direction,
    createdTs: proposal.createdTs,
    updatedTs: proposal.updatedTs,
    status: proposal.status,
    reason: proposal.reason,
    grossEdgePct: proposal.grossEdgePct,
    netEdgePct: proposal.netEdgePct,
    fundingAdjPct: proposal.fundingAdjPct,
    borrowRequired: proposal.borrowRequired,
    borrowStatus: proposal.borrowStatus,
    suggestedNotionalUsd: proposal.suggestedNotionalUsd,
    confidence: proposal.confidence,
    invalidation: proposal.invalidation,
    evidence: frozenEvidence(proposal.evidence),
    proposalRevision: proposal.proposalRevision,
    proposalDigest: proposal.proposalDigest,
    configurationRevision: proposal.configurationRevision,
    featureObservedAtMs: proposal.featureObservedAtMs,
    expiresAtMs: proposal.expiresAtMs,
    baselineVolume: proposal.baselineVolume,
    currentVolume1m: proposal.currentVolume1m,
    tradeCountMultiple: proposal.tradeCountMultiple,
    riskResult: projectRiskResult(proposal.riskResult),
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

  private expireProposal(
    proposal: StoredProposal,
    why: InvalidationReason,
    now: number,
  ): void {
    proposal.status = 'expired';
    proposal.updatedTs = now;
    proposal.invalidatedBy = why;
    proposal.riskResult = null;
    if (proposal.proposalRevision < Number.MAX_SAFE_INTEGER) proposal.proposalRevision += 1;
    proposal.proposalDigest = proposalDigest(proposal);
  }

  /** Create or refresh the open proposal for a symbol from a proposal decision. */
  upsertFromDecision(d: Decision, f: WakeupSnapshot): VolumeProposal {
    const now = this.clock.now();
    if (
      d.kind !== 'proposal'
      || d.strategy !== 'volume_spike'
      || d.rejectCode !== null
      || d.symbol !== f.symbol
      || d.ts !== f.ts
      || !Number.isSafeInteger(d.ts)
      || d.ts < 0
      || d.ts > now
      || now - d.ts > this.cfg.staleMs
      || (d.evidence.direction !== 'long' && d.evidence.direction !== 'short')
      || typeof d.correlationId !== 'string'
      || d.correlationId.length === 0
      || d.correlationId.length > 128
    ) throw new TypeError('Volume proposal decision and feature cut are not exactly bound');
    const direction = d.evidence.direction;
    const confidence = typeof d.evidence.confidence === 'number' && Number.isFinite(d.evidence.confidence)
      ? Math.max(0, Math.min(1, d.evidence.confidence))
      : null;
    const evidence = boundedEvidence(d.evidence);
    const configRevision = configurationRevision(this.cfg);
    const baselineVolume = Number.isFinite(f.baseline.quotePerMinMedian) && f.baseline.quotePerMinMedian >= 0
      ? f.baseline.quotePerMinMedian : null;
    const currentVolume1m = Number.isFinite(f.windows['60s']?.quoteVolume)
      && (f.windows['60s']?.quoteVolume ?? -1) >= 0
      ? f.windows['60s']!.quoteVolume : null;
    const tradeCountMultiple = typeof f.tradeCountMultiple['5s'] === 'number'
      && Number.isFinite(f.tradeCountMultiple['5s']) && f.tradeCountMultiple['5s']! >= 0
      ? f.tradeCountMultiple['5s']! : null;
    const fingerprint = proposalFingerprint(
      d.symbol,
      d.correlationId,
      f.ts,
      configRevision,
      direction,
      confidence,
      d.humanReason,
      evidence,
      baselineVolume,
      currentVolume1m,
      tradeCountMultiple,
    );
    const refPrice = f.spotAsk ?? f.spotBid;
    const existingId = this.openBySymbol.get(d.symbol);
    let existing = existingId ? this.proposals.get(existingId) : undefined;

    if (existing
        && (existing.status === 'open' || existing.status === 'updated')
        && d.correlationId !== existing.correlationId) {
      if (f.ts <= existing.featureObservedAtMs || now < existing.updatedTs) {
        return projectProposal(existing);
      }
      this.expireProposal(existing, 'signal_superseded', now);
      this.openBySymbol.delete(d.symbol);
      this.sink.emit(
        makeEvent('proposal_expired', now, existing.correlationId, 'proposal invalidated: signal_superseded', {
          symbol: d.symbol,
          payload: { id: existing.id, invalidatedBy: 'signal_superseded' },
        }),
      );
      existing = undefined;
    }

    if (existing && existing.status !== 'expired' && existing.status !== 'rejected') {
      if (f.ts < existing.featureObservedAtMs || now < existing.updatedTs) return projectProposal(existing);
      if (this.fingerprintById.get(existing.id) === fingerprint) return projectProposal(existing);
      if (f.ts === existing.featureObservedAtMs) return projectProposal(existing);
      if (existing.proposalRevision >= Number.MAX_SAFE_INTEGER) return projectProposal(existing);
      existing.updatedTs = now;
      existing.status = 'updated';
      existing.direction = direction;
      existing.confidence = confidence;
      existing.evidence = evidence;
      existing.reason = d.humanReason;
      existing.baselineVolume = baselineVolume;
      existing.currentVolume1m = currentVolume1m;
      existing.tradeCountMultiple = tradeCountMultiple;
      existing.suggestedNotionalUsd = this.cfg.suggestedNotionalUsd;
      existing.proposalRevision += 1;
      existing.configurationRevision = configRevision;
      existing.featureObservedAtMs = f.ts;
      existing.expiresAtMs = existing.createdTs + this.cfg.proposalTtlMs;
      existing.riskResult = null;
      existing.rule = {
        volumeNormalizedBelowMultiple: this.cfg.volumeNormalizedBelowMultiple,
        spreadBlownOutBps: this.cfg.spreadBlownOutBps,
        moveExhaustedPct: this.cfg.maxExtendedMovePct,
        referencePrice: refPrice,
      };
      existing.invalidation = `invalid if 60s volume multiple < ${existing.rule.volumeNormalizedBelowMultiple}×, spread > ${existing.rule.spreadBlownOutBps}bps, ${refPrice === null ? 'reference price remains unknown' : `|move| from ${refPrice} > ${existing.rule.moveExhaustedPct}%`}, or ${this.cfg.proposalTtlMs / 60000}min TTL`;
      existing.proposalDigest = proposalDigest(existing);
      this.fingerprintById.set(existing.id, fingerprint);
      this.sink.emit(
        makeEvent('proposal_updated', now, existing.correlationId, `proposal refreshed: ${d.humanReason}`, {
          symbol: d.symbol,
          payload: { id: existing.id, confidence },
        }),
      );
      return projectProposal(existing);
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
      invalidation: `invalid if 60s volume multiple < ${rule.volumeNormalizedBelowMultiple}×, spread > ${rule.spreadBlownOutBps}bps, ${refPrice === null ? 'reference price remains unknown' : `|move| from ${refPrice} > ${rule.moveExhaustedPct}%`}, or ${this.cfg.proposalTtlMs / 60000}min TTL`,
      evidence,
      proposalRevision: 1,
      proposalDigest: '',
      configurationRevision: configRevision,
      featureObservedAtMs: f.ts,
      expiresAtMs: now + this.cfg.proposalTtlMs,
      baselineVolume,
      currentVolume1m,
      tradeCountMultiple,
      riskResult: null,
      rule,
      invalidatedBy: null,
    };
    p.proposalDigest = proposalDigest(p);
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
    return projectProposal(p);
  }

  /** Expire proposals whose symbols left the configured universe. */
  reconcileSymbols(symbols: ReadonlySet<string>): void {
    const now = this.clock.now();
    for (const [symbol, id] of this.openBySymbol) {
      if (symbols.has(symbol)) continue;
      const proposal = this.proposals.get(id);
      this.openBySymbol.delete(symbol);
      if (!proposal || (proposal.status !== 'open' && proposal.status !== 'updated')) continue;
      this.expireProposal(proposal, 'universe_removed', now);
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
    const now = this.clock.now();
    this.expireProposal(oldest, 'capacity_pruned', now);
    if (this.openBySymbol.get(oldest.symbol) === oldest.id) this.openBySymbol.delete(oldest.symbol);
    this.proposals.delete(oldest.id);
    this.fingerprintById.delete(oldest.id);
    this.sink.emit(
      makeEvent('proposal_expired', now, oldest.correlationId, 'proposal invalidated: capacity_pruned', {
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
    if (now >= p.expiresAtMs) why = 'ttl_expired';
    const m60 = f.volumeMultiple['60s'];
    if (!why && m60 !== null && m60 !== undefined && m60 < p.rule.volumeNormalizedBelowMultiple)
      why = 'volume_normalized';
    if (!why && f.spotSpreadBps !== null && f.spotSpreadBps >= p.rule.spreadBlownOutBps)
      why = 'spread_blown_out';
    const price = f.spotAsk ?? f.spotBid;
    const referencePrice = p.rule.referencePrice;
    if (!why && price !== null && referencePrice !== null && referencePrice > 0) {
      const movePct = Math.abs((price - referencePrice) / referencePrice) * 100;
      if (movePct >= p.rule.moveExhaustedPct) why = 'move_exhausted';
    }
    if (!why) return;

    this.expireProposal(p, why, now);
    this.openBySymbol.delete(f.symbol);
    this.sink.emit(
      makeEvent('proposal_expired', now, p.correlationId, `proposal invalidated: ${why}`, {
        symbol: f.symbol,
        payload: { id: p.id, invalidatedBy: why },
      }),
    );
  }

  /**
   * The ONLY path toward execution: mint a stub for the Foundation risk path.
   * Kill switch blocks it here regardless of what upstream believed.
   */
  intentFor(proposalId: string, killSwitch: boolean): IntentResult {
    const p = this.proposals.get(proposalId);
    if (!p) return { ok: false, reason: 'proposal_unknown' };
    if (p.status !== 'open' && p.status !== 'updated') return { ok: false, reason: 'proposal_not_open' };
    const now = this.clock.now();
    if (now >= p.expiresAtMs) {
      this.expireProposal(p, 'ttl_expired', now);
      if (this.openBySymbol.get(p.symbol) === p.id) this.openBySymbol.delete(p.symbol);
      this.sink.emit(
        makeEvent('proposal_expired', now, p.correlationId, 'proposal invalidated: ttl_expired', {
          symbol: p.symbol,
          payload: { id: p.id, invalidatedBy: 'ttl_expired' },
        }),
      );
      return { ok: false, reason: 'proposal_not_open' };
    }
    if (killSwitch) {
      this.sink.emit(
        makeEvent('risk_rejected', now, p.correlationId, 'intent blocked: kill switch is ON', {
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

  /** Passive exact source cut for System Integration's Foundation composer. */
  readProposalRiskCut(proposalId: string): Readonly<VolumeProposalRiskCut> | null {
    if (typeof proposalId !== 'string' || proposalId.length === 0 || proposalId.length > 128) return null;
    const proposal = this.proposals.get(proposalId);
    const now = this.clock.now();
    if (!proposal
        || (proposal.status !== 'open' && proposal.status !== 'updated')
        || now >= proposal.expiresAtMs) return null;
    return Object.freeze({
      proposalId: proposal.id,
      proposalRevision: proposal.proposalRevision,
      proposalDigest: proposal.proposalDigest,
      configurationRevision: proposal.configurationRevision,
      correlationId: proposal.correlationId,
      symbol: proposal.symbol,
      direction: proposal.direction,
      updatedTs: proposal.updatedTs,
      featureObservedAtMs: proposal.featureObservedAtMs,
      expiresAtMs: proposal.expiresAtMs,
    });
  }

  /**
   * Compare-and-record one canonical Foundation verdict against the exact
   * still-current Volume cut. This method never evaluates or upgrades risk.
   */
  recordFoundationRiskResult(input: Readonly<VolumeFoundationRiskAttachmentInput>): boolean {
    if (!input || typeof input !== 'object') return false;
    const proposal = this.proposals.get(input.expectedProposalId);
    const now = this.clock.now();
    if (!proposal
        || (proposal.status !== 'open' && proposal.status !== 'updated')
        || proposal.id !== input.expectedProposalId
        || proposal.proposalRevision !== input.expectedProposalRevision
        || proposal.proposalDigest !== input.expectedProposalDigest
        || proposal.configurationRevision !== input.expectedConfigurationRevision
        || proposal.correlationId !== input.expectedCorrelationId
        || now >= proposal.expiresAtMs) return false;
    let expectedCanonicalProposalId: string;
    let expectedPlanId: string;
    try {
      const sourceRecordId = deriveSourceProposalId({ source: 'VOLUME', engineKey: proposal.id });
      expectedCanonicalProposalId = deriveCanonicalProposalId({
        source: 'VOLUME',
        sourceRecordId,
        symbol: proposal.symbol,
      });
      expectedPlanId = derivePlanId({ canonicalProposalId: expectedCanonicalProposalId, attempt: 0 });
    } catch {
      return false;
    }
    if (!/^cprop_[0-9a-f]{16}$/.test(input.canonicalProposalId)
        || input.canonicalProposalId !== expectedCanonicalProposalId
        || !/^plan_[0-9a-f]{16}$/.test(input.planId)
        || input.planId !== expectedPlanId
        || typeof input.riskIntentDigest !== 'string'
        || !/^riskint_[0-9a-f]{32}$/.test(input.riskIntentDigest)
        || typeof input.verdictDigest !== 'string'
        || !/^riskv_[0-9a-f]{32}$/.test(input.verdictDigest)) return false;

    const verdict = input.verdict;
    if (!isExactPlainDataRecord(verdict, VERDICT_KEYS)
        || typeof verdict.allowed !== 'boolean'
        || !isValidUtcMillis(verdict.evaluatedAt)
        || !isValidUtcMillis(verdict.expiresAt)
        || verdict.evaluatedAt > now
        || verdict.evaluatedAt < proposal.updatedTs
        || verdict.evaluatedAt < proposal.featureObservedAtMs
        || verdict.expiresAt <= now
        || verdict.expiresAt > proposal.expiresAtMs
        || !isDensePlainArray(verdict.checks)
        || verdict.checks.length === 0
        || verdict.checks.length > 128
        || verdict.checks.some((check) => !isExactPlainDataRecord(check, RISK_CHECK_KEYS)
          || validateRiskCheck(check).length > 0)
        || !isDensePlainArray(verdict.blockingCodes)
        || verdict.blockingCodes.length > 128
        || verdict.blockingCodes.some((code) => typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(code))) {
      return false;
    }
    const normalizedChecks = Object.freeze(verdict.checks.map((check) => Object.freeze({
      code: check.code,
      status: check.status,
      blocking: check.blocking,
      detail: check.detail,
      observed: check.observed,
      limit: check.limit,
      evidenceTimestamp: check.evidenceTimestamp,
    })));
    const normalizedBlockingCodes = Object.freeze([...verdict.blockingCodes]);
    const normalizedVerdict = Object.freeze({
      allowed: verdict.allowed,
      evaluatedAt: verdict.evaluatedAt,
      expiresAt: verdict.expiresAt,
      checks: normalizedChecks,
      blockingCodes: normalizedBlockingCodes,
    });
    const derivedBlockingCodes = normalizedChecks
      .filter((check) => check.blocking && check.status !== 'PASS')
      .map((check) => check.code);
    if (normalizedVerdict.allowed !== (derivedBlockingCodes.length === 0)
        || derivedBlockingCodes.length !== normalizedBlockingCodes.length
        || derivedBlockingCodes.some((code, index) => code !== normalizedBlockingCodes[index])) return false;
    try {
      if (verdictDigest(normalizedVerdict) !== input.verdictDigest) return false;
    } catch {
      return false;
    }

    const previous = proposal.riskResult;
    if (previous !== null) {
      if (previous.verdictDigest === input.verdictDigest
          && previous.riskIntentDigest === input.riskIntentDigest
          && previous.planId === input.planId
          && previous.canonicalProposalId === input.canonicalProposalId) return true;
      if (normalizedVerdict.evaluatedAt < previous.evaluatedAt
          || normalizedVerdict.evaluatedAt === previous.evaluatedAt
          || (!previous.allowed && normalizedVerdict.allowed)) return false;
    }

    const result: Readonly<VolumeFoundationRiskResult> = Object.freeze({
      owner: 'FOUNDATION_MULTI_LEG_RISK',
      proposalId: proposal.id,
      canonicalProposalId: input.canonicalProposalId,
      proposalRevision: proposal.proposalRevision,
      proposalDigest: proposal.proposalDigest,
      configurationRevision: proposal.configurationRevision,
      correlationId: proposal.correlationId,
      planId: input.planId,
      riskIntentDigest: input.riskIntentDigest,
      verdictDigest: input.verdictDigest,
      allowed: normalizedVerdict.allowed,
      evaluatedAt: normalizedVerdict.evaluatedAt,
      expiresAt: normalizedVerdict.expiresAt,
      checks: normalizedChecks,
      blockingCodes: normalizedBlockingCodes,
    });
    proposal.riskResult = result;
    this.sink.emit(makeEvent(
      normalizedVerdict.allowed ? 'risk_approved' : 'risk_rejected',
      now,
      proposal.correlationId,
      normalizedVerdict.allowed ? 'Foundation risk approved exact proposal cut' : 'Foundation risk rejected exact proposal cut',
      {
        symbol: proposal.symbol,
        payload: {
          proposalId: proposal.id,
          proposalRevision: proposal.proposalRevision,
          proposalDigest: proposal.proposalDigest,
          verdictDigest: input.verdictDigest,
          blockingCodes: [...normalizedBlockingCodes],
        },
      },
    ));
    return true;
  }

  openProposals(): VolumeProposal[] {
    return [...this.proposals.values()]
      .filter((p) => p.status === 'open' || p.status === 'updated')
      .map(projectProposal);
  }

  all(): VolumeProposal[] {
    return [...this.proposals.values()].map(projectProposal);
  }

  byId(id: string): VolumeProposal | undefined {
    const proposal = this.proposals.get(id);
    return proposal ? projectProposal(proposal) : undefined;
  }

  openFor(symbol: string): VolumeProposal | undefined {
    const id = this.openBySymbol.get(symbol);
    const proposal = id ? this.proposals.get(id) : undefined;
    return proposal ? projectProposal(proposal) : undefined;
  }
}
