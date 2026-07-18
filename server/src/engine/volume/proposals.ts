/**
 * Proposal store — ENGINE.md §9 proposal fields + §13 V0 posture.
 * Proposals are structured suggestions with invalidation metadata. There is
 * NO automatic buy/sell: the only exit toward execution is `intentFor()`,
 * which mints a stub for the canonical Foundation risk evaluator and refuses
 * outright when the kill switch is on. Every lifecycle step is ledgered with
 * the signal's correlationId.
 */
import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
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
  type RiskCheck,
  type RiskVerdict,
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
  | { ok: false; reason: 'kill_switch_on' | 'intake_paused' | 'symbol_blocked' | 'proposal_not_open' | 'proposal_unknown' };

interface StoredProposal extends VolumeProposal {
  rule: InvalidationRule;
  invalidatedBy: InvalidationReason | null;
}

const MAX_PROPOSALS = 2_000;
const VERDICT_KEYS = Object.freeze([
  'allowed',
  'blockingCodes',
  'checks',
  'correlationId',
  'decision',
  'decisiveInputSnapshot',
  'evaluatedAt',
  'expiresAt',
  'maxAllowedSize',
  'requiredConfirmation',
]);
const DECISIVE_INPUT_KEYS = Object.freeze(['checks', 'evaluatedAt']);
const RISK_CHECK_KEYS = Object.freeze([
  'blocking',
  'code',
  'detail',
  'evidenceTimestamp',
  'limit',
  'observed',
  'status',
]);
const DECISION_KEYS = Object.freeze([
  'correlationId',
  'evidence',
  'humanReason',
  'kind',
  'rejectCode',
  'strategy',
  'symbol',
  'ts',
]);
const RISK_ATTACHMENT_KEYS = Object.freeze([
  'canonicalProposalId',
  'expectedConfigurationRevision',
  'expectedCorrelationId',
  'expectedProposalDigest',
  'expectedProposalId',
  'expectedProposalRevision',
  'planId',
  'riskIntentDigest',
  'verdict',
  'verdictDigest',
]);
const FEATURE_KEYS = Object.freeze([
  'accelerationPctPerMin',
  'baseline',
  'baselineReady',
  'basisLongSpotPct',
  'basisShortSpotPct',
  'basisSlopePctPerMin',
  'book',
  'depthScore',
  'focusAgeMs',
  'fundingRate',
  'markPrice',
  'perpAsk',
  'perpBid',
  'perpSpreadBps',
  'perpStalenessMs',
  'realizedVolPct',
  'signalAgeMs',
  'spotAsk',
  'spotBid',
  'spotSpreadBps',
  'spotStalenessMs',
  'symbol',
  'tape',
  'tradeCountMultiple',
  'ts',
  'volumeMultiple',
  'windows',
]);
const BASELINE_KEYS = Object.freeze([
  'confidence',
  'isDead',
  'quotePerMinMad',
  'quotePerMinMedian',
  'quotePerSecNorm',
  'ready',
  'samples',
  'tradesPerSecNorm',
]);
const WINDOW_KEYS = Object.freeze(['15s', '1h', '1s', '5m', '5s', '60s']);
const WINDOW_STATS_KEYS = Object.freeze([
  'avgTradeSize',
  'largeTradeCount',
  'priceMovePct',
  'quoteVolume',
  'takerBuyRatio',
  'tradeCount',
]);
const PROPOSAL_EVIDENCE_KEYS = Object.freeze([
  'accelPctPerMin',
  'baselineConfidence',
  'baselineSamples',
  'burstClusters',
  'confidence',
  'depthScore',
  'depthVsNorm',
  'detailCode',
  'direction',
  'focusAgeMs',
  'isDeadBaseline',
  'largeTrades60s',
  'm15s',
  'm1s',
  'm5s',
  'maxTradeDominance',
  'move15sPct',
  'move5mPct',
  'priceRangePct',
  'signalAgeMs',
  'spreadBps',
  'takerBuyRatio',
  'tcMult5s',
  'trades5s',
  'vol1sQuote',
  'washScore',
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPrototypePollutionKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

/** Snapshot own data once without invoking caller getters, proxy traps, or coercion. */
function snapshotOwnDataRecord(
  input: unknown,
  maximumKeys: number,
): Readonly<Record<string, unknown>> | null {
  if (typeof input !== 'object' || input === null || utilTypes.isProxy(input) || Array.isArray(input)) return null;
  try {
    if (Object.getPrototypeOf(input) !== Object.prototype) return null;
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.length > maximumKeys
        || ownKeys.some((key) => typeof key === 'symbol'
          || isPrototypePollutionKey(key as string))) return null;
    const keys = (ownKeys as string[]).sort(compareText);
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !('value' in descriptor) || descriptor.enumerable !== true) return null;
      Object.defineProperty(snapshot, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function snapshotExactOwnDataRecord(
  input: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  const snapshot = snapshotOwnDataRecord(input, expectedKeys.length);
  if (snapshot === null) return null;
  const keys = Object.keys(snapshot).sort(compareText);
  return keys.length === expectedKeys.length
      && keys.every((key, index) => key === expectedKeys[index])
    ? snapshot
    : null;
}

function snapshotAllowedOwnDataRecord(
  input: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  const snapshot = snapshotOwnDataRecord(input, allowedKeys.length);
  if (snapshot === null) return null;
  const allowed = new Set(allowedKeys);
  return Object.keys(snapshot).every((key) => allowed.has(key)) ? snapshot : null;
}

function snapshotDenseOwnDataArray(input: unknown, maximumLength: number): readonly unknown[] | null {
  if (typeof input !== 'object' || input === null || utilTypes.isProxy(input) || !Array.isArray(input)) return null;
  try {
    if (Object.getPrototypeOf(input) !== Array.prototype) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, 'length');
    const lengthValue = lengthDescriptor?.value;
    if (typeof lengthValue !== 'number'
        || !Number.isSafeInteger(lengthValue)
        || lengthValue < 0
        || lengthValue > maximumLength) return null;
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.length !== lengthValue + 1
        || ownKeys.some((key) => typeof key === 'symbol')) return null;
    const snapshot: unknown[] = [];
    for (let index = 0; index < lengthValue; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function snapshotRiskCheck(input: unknown): Readonly<RiskCheck> | null {
  const record = snapshotExactOwnDataRecord(input, RISK_CHECK_KEYS);
  if (record === null) return null;
  if ((typeof record.observed === 'number' && Object.is(record.observed, -0))
      || (typeof record.limit === 'number' && Object.is(record.limit, -0))
      || (typeof record.evidenceTimestamp === 'number' && Object.is(record.evidenceTimestamp, -0))) return null;
  const snapshot = Object.freeze({
    code: record.code,
    status: record.status,
    blocking: record.blocking,
    detail: record.detail,
    observed: record.observed,
    limit: record.limit,
    evidenceTimestamp: record.evidenceTimestamp,
  }) as unknown as Readonly<RiskCheck>;
  return validateRiskCheck(snapshot).length === 0 ? snapshot : null;
}

function sameRiskCheck(left: Readonly<RiskCheck>, right: Readonly<RiskCheck>): boolean {
  return left.code === right.code
    && left.status === right.status
    && left.blocking === right.blocking
    && left.detail === right.detail
    && left.observed === right.observed
    && left.limit === right.limit
    && left.evidenceTimestamp === right.evidenceTimestamp;
}

interface ProposalFeatureCut {
  readonly symbol: string;
  readonly ts: number;
  readonly baselineVolume: number | null;
  readonly currentVolume1m: number | null;
  readonly tradeCountMultiple: number | null;
  readonly referencePrice: number | null;
}

function nullablePositive(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);
}

function nullableNonNegative(value: unknown): value is number | null | undefined {
  return value === null
    || value === undefined
    || (typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0
      && !Object.is(value, -0));
}

function containsNegativeZero(input: Readonly<Record<string, unknown>>): boolean {
  return Object.values(input).some(
    (value) => typeof value === 'number' && Object.is(value, -0),
  );
}

function isValidProposalClockTime(value: unknown): value is number {
  return typeof value === 'number'
    && !Object.is(value, -0)
    && isValidUtcMillis(value);
}

/** Capture only the feature fields that can influence proposal identity. */
function snapshotProposalFeatureCut(input: unknown): Readonly<ProposalFeatureCut> | null {
  const feature = snapshotExactOwnDataRecord(input, FEATURE_KEYS);
  const baseline = feature === null ? null : snapshotExactOwnDataRecord(feature.baseline, BASELINE_KEYS);
  const windows = feature === null ? null : snapshotAllowedOwnDataRecord(feature.windows, WINDOW_KEYS);
  const tradeCounts = feature === null
    ? null
    : snapshotAllowedOwnDataRecord(feature.tradeCountMultiple, WINDOW_KEYS);
  if (feature === null || baseline === null || windows === null || tradeCounts === null) return null;
  const window60Value = windows['60s'];
  const window60 = window60Value === undefined
    ? null
    : snapshotExactOwnDataRecord(window60Value, WINDOW_STATS_KEYS);
  if (window60Value !== undefined && window60 === null) return null;
  if (typeof feature.symbol !== 'string'
      || feature.symbol.length === 0
      || feature.symbol.length > 64
      || !Number.isSafeInteger(feature.ts)
      || (feature.ts as number) < 0
      || Object.is(feature.ts, -0)
      || !nullablePositive(feature.spotAsk)
      || !nullablePositive(feature.spotBid)) return null;
  const baselineValue = baseline.quotePerMinMedian;
  const currentValue = window60?.quoteVolume;
  const tradeCountValue = tradeCounts['5s'];
  if (!nullableNonNegative(baselineValue)
      || !nullableNonNegative(currentValue)
      || !nullableNonNegative(tradeCountValue)) return null;
  return Object.freeze({
    symbol: feature.symbol,
    ts: feature.ts as number,
    baselineVolume: typeof baselineValue === 'number'
        && Number.isFinite(baselineValue)
        && baselineValue >= 0
      ? baselineValue
      : null,
    currentVolume1m: typeof currentValue === 'number'
        && Number.isFinite(currentValue)
        && currentValue >= 0
      ? currentValue
      : null,
    tradeCountMultiple: typeof tradeCountValue === 'number'
        && Number.isFinite(tradeCountValue)
        && tradeCountValue >= 0
      ? tradeCountValue
      : null,
    referencePrice: feature.spotAsk ?? feature.spotBid,
  });
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
    decisiveInputSnapshot: Object.freeze({
      evaluatedAt: result.decisiveInputSnapshot.evaluatedAt,
      checks: Object.freeze(result.decisiveInputSnapshot.checks.map((check) => Object.freeze({
        code: check.code,
        status: check.status,
        blocking: check.blocking,
        detail: check.detail,
        observed: check.observed,
        limit: check.limit,
        evidenceTimestamp: check.evidenceTimestamp,
      }))),
    }),
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

  private strictNow(): number {
    const now = this.clock.now();
    if (!isValidProposalClockTime(now)) {
      throw new TypeError('Volume proposal clock returned invalid UTC ms');
    }
    return now;
  }

  private expireProposal(
    proposal: StoredProposal,
    why: InvalidationReason,
    now: number,
  ): void {
    if (!isValidProposalClockTime(now)) {
      throw new TypeError('Volume proposal mutation received invalid UTC ms');
    }
    proposal.status = 'expired';
    proposal.updatedTs = now;
    proposal.invalidatedBy = why;
    proposal.riskResult = null;
    if (proposal.proposalRevision < Number.MAX_SAFE_INTEGER) proposal.proposalRevision += 1;
    proposal.proposalDigest = proposalDigest(proposal);
  }

  private expireAllAt(why: InvalidationReason, now: number): void {
    if (!isValidProposalClockTime(now)) {
      throw new TypeError('Volume proposal expiry mutation received invalid UTC ms');
    }
    for (const p of this.proposals.values()) {
      if (p.status !== 'open' && p.status !== 'updated') continue;
      this.expireProposal(p, why, now);
      this.openBySymbol.delete(p.symbol);
      this.sink.emit(makeEvent('proposal_expired', now, p.correlationId, `proposal invalidated: ${why}`, {
        symbol: p.symbol,
        payload: { id: p.id, invalidatedBy: why },
      }));
    }
  }

  expireAll(why: InvalidationReason): void {
    this.expireAllAt(why, this.strictNow());
  }

  expireForSymbol(symbol: string, why: InvalidationReason): void {
    const now = this.strictNow();
    const id = this.openBySymbol.get(symbol);
    if (!id) return;
    const proposal = this.proposals.get(id);
    if (!proposal || (proposal.status !== 'open' && proposal.status !== 'updated')) return;
    this.expireProposal(proposal, why, now);
    this.openBySymbol.delete(symbol);
    this.sink.emit(makeEvent('proposal_expired', now, proposal.correlationId, `proposal invalidated: ${why}`, {
      symbol,
      payload: { id, invalidatedBy: why },
    }));
  }

  /** Create or refresh the open proposal for a symbol from a proposal decision. */
  upsertFromDecision(d: Decision, f: WakeupSnapshot): VolumeProposal {
    const now = this.strictNow();
    const decision = snapshotExactOwnDataRecord(d, DECISION_KEYS);
    const decisionEvidence = decision === null
      ? null
      : snapshotAllowedOwnDataRecord(decision.evidence, PROPOSAL_EVIDENCE_KEYS);
    const feature = snapshotProposalFeatureCut(f);
    if (
      decision === null
      || decisionEvidence === null
      || feature === null
      || decision.kind !== 'proposal'
      || decision.strategy !== 'volume_spike'
      || decision.rejectCode !== null
      || decision.symbol !== feature.symbol
      || decision.ts !== feature.ts
      || !Number.isSafeInteger(decision.ts)
      || (decision.ts as number) < 0
      || Object.is(decision.ts, -0)
      || containsNegativeZero(decisionEvidence)
      || (decision.ts as number) > now
      || now - (decision.ts as number) > this.cfg.staleMs
      || (decisionEvidence.direction !== 'long' && decisionEvidence.direction !== 'short')
      || typeof decision.correlationId !== 'string'
      || decision.correlationId.length === 0
      || decision.correlationId.length > 128
      || typeof decision.humanReason !== 'string'
      || decision.humanReason.length === 0
      || decision.humanReason.length > 1_024
    ) throw new TypeError('Volume proposal decision and feature cut are not exactly bound');
    const symbol = decision.symbol as string;
    const correlationId = decision.correlationId;
    const humanReason = decision.humanReason;
    const direction = decisionEvidence.direction;
    const confidence = typeof decisionEvidence.confidence === 'number'
      && Number.isFinite(decisionEvidence.confidence)
      ? Math.max(0, Math.min(1, decisionEvidence.confidence))
      : null;
    const evidence = boundedEvidence(
      decisionEvidence as Readonly<Record<string, number | string | boolean | null>>,
    );
    const configRevision = configurationRevision(this.cfg);
    const baselineVolume = feature.baselineVolume;
    const currentVolume1m = feature.currentVolume1m;
    const tradeCountMultiple = feature.tradeCountMultiple;
    const fingerprint = proposalFingerprint(
      symbol,
      correlationId,
      feature.ts,
      configRevision,
      direction,
      confidence,
      humanReason,
      evidence,
      baselineVolume,
      currentVolume1m,
      tradeCountMultiple,
    );
    const refPrice = feature.referencePrice;
    const existingId = this.openBySymbol.get(symbol);
    let existing = existingId ? this.proposals.get(existingId) : undefined;

    if (existing
        && (existing.status === 'open' || existing.status === 'updated')
        && correlationId !== existing.correlationId) {
      if (feature.ts <= existing.featureObservedAtMs || now < existing.updatedTs) {
        return projectProposal(existing);
      }
      this.expireProposal(existing, 'signal_superseded', now);
      this.openBySymbol.delete(symbol);
      this.sink.emit(
        makeEvent('proposal_expired', now, existing.correlationId, 'proposal invalidated: signal_superseded', {
          symbol,
          payload: { id: existing.id, invalidatedBy: 'signal_superseded' },
        }),
      );
      existing = undefined;
    }

    if (existing && existing.status !== 'expired' && existing.status !== 'rejected') {
      if (feature.ts < existing.featureObservedAtMs || now < existing.updatedTs) return projectProposal(existing);
      if (this.fingerprintById.get(existing.id) === fingerprint) return projectProposal(existing);
      if (feature.ts === existing.featureObservedAtMs) return projectProposal(existing);
      if (existing.proposalRevision >= Number.MAX_SAFE_INTEGER) return projectProposal(existing);
      existing.updatedTs = now;
      existing.status = 'updated';
      existing.direction = direction;
      existing.confidence = confidence;
      existing.evidence = evidence;
      existing.reason = humanReason;
      existing.baselineVolume = baselineVolume;
      existing.currentVolume1m = currentVolume1m;
      existing.tradeCountMultiple = tradeCountMultiple;
      existing.suggestedNotionalUsd = this.cfg.suggestedNotionalUsd;
      existing.proposalRevision += 1;
      existing.configurationRevision = configRevision;
      existing.featureObservedAtMs = feature.ts;
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
        makeEvent('proposal_updated', now, existing.correlationId, `proposal refreshed: ${humanReason}`, {
          symbol,
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
      id: newCorrelationId({ now: () => now }, 'vp'),
      correlationId,
      strategy: 'volume_spike',
      symbol,
      direction,
      createdTs: now,
      updatedTs: now,
      status: 'open',
      reason: humanReason,
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
      featureObservedAtMs: feature.ts,
      expiresAtMs: now + this.cfg.proposalTtlMs,
      baselineVolume,
      currentVolume1m,
      tradeCountMultiple,
      riskResult: null,
      rule,
      invalidatedBy: null,
    };
    p.proposalDigest = proposalDigest(p);
    this.makeRoomForProposal(now);
    this.proposals.set(p.id, p);
    this.fingerprintById.set(p.id, fingerprint);
    this.openBySymbol.set(symbol, p.id);
    this.sink.emit(
      makeEvent('proposal_created', now, p.correlationId, `proposal: ${humanReason}`, {
        symbol,
        payload: { id: p.id, direction, confidence, invalidation: p.invalidation },
      }),
    );
    return projectProposal(p);
  }

  /** Expire proposals whose symbols left the configured universe. */
  reconcileSymbols(symbols: ReadonlySet<string>): void {
    this.reconcileSymbolsAt(symbols, this.strictNow());
  }

  /** Same mutation with one already-validated Engine-owned clock cut. */
  reconcileSymbolsAt(symbols: ReadonlySet<string>, now: number): void {
    if (!isValidProposalClockTime(now)) {
      throw new TypeError('Volume proposal universe mutation received invalid UTC ms');
    }
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

  private makeRoomForProposal(now: number): void {
    if (!isValidProposalClockTime(now)) {
      throw new TypeError('Volume proposal capacity mutation received invalid UTC ms');
    }
    this.pruneTerminal(MAX_PROPOSALS - 1);
    if (this.proposals.size < MAX_PROPOSALS) return;
    let oldest: StoredProposal | null = null;
    for (const proposal of this.proposals.values()) {
      if (!oldest || proposal.updatedTs < oldest.updatedTs) oldest = proposal;
    }
    if (!oldest) return;
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
    const now = this.strictNow();
    const id = this.openBySymbol.get(f.symbol);
    if (!id) return;
    const p = this.proposals.get(id);
    if (!p || (p.status !== 'open' && p.status !== 'updated')) return;
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
  intentFor(proposalId: string, killSwitch: boolean, intakePaused = false): IntentResult {
    const now = this.strictNow();
    const p = this.proposals.get(proposalId);
    if (!p) return { ok: false, reason: 'proposal_unknown' };
    if (intakePaused) {
      if (p.status === 'open' || p.status === 'updated') this.expireAllAt('intake_paused', now);
      return { ok: false, reason: 'intake_paused' };
    }
    if (p.status !== 'open' && p.status !== 'updated') return { ok: false, reason: 'proposal_not_open' };
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
    let now: number;
    try {
      now = this.strictNow();
    } catch {
      return null;
    }
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
    let now: number;
    try {
      now = this.strictNow();
    } catch {
      return false;
    }
    const attachment = snapshotExactOwnDataRecord(input, RISK_ATTACHMENT_KEYS);
    if (attachment === null
        || typeof attachment.expectedProposalId !== 'string'
        || attachment.expectedProposalId.length === 0
        || attachment.expectedProposalId.length > 128
        || !Number.isSafeInteger(attachment.expectedProposalRevision)
        || (attachment.expectedProposalRevision as number) < 1
        || typeof attachment.expectedProposalDigest !== 'string'
        || typeof attachment.expectedConfigurationRevision !== 'string'
        || typeof attachment.expectedCorrelationId !== 'string'
        || attachment.expectedCorrelationId.length === 0
        || attachment.expectedCorrelationId.length > 128
        || typeof attachment.canonicalProposalId !== 'string'
        || typeof attachment.planId !== 'string'
        || typeof attachment.riskIntentDigest !== 'string'
        || typeof attachment.verdictDigest !== 'string') return false;
    const proposal = this.proposals.get(attachment.expectedProposalId);
    if (!proposal
        || (proposal.status !== 'open' && proposal.status !== 'updated')
        || proposal.id !== attachment.expectedProposalId
        || proposal.proposalRevision !== attachment.expectedProposalRevision
        || proposal.proposalDigest !== attachment.expectedProposalDigest
        || proposal.configurationRevision !== attachment.expectedConfigurationRevision
        || proposal.correlationId !== attachment.expectedCorrelationId
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
    if (!/^cprop_[0-9a-f]{16}$/.test(attachment.canonicalProposalId)
        || attachment.canonicalProposalId !== expectedCanonicalProposalId
        || !/^plan_[0-9a-f]{16}$/.test(attachment.planId)
        || attachment.planId !== expectedPlanId
        || !/^riskint_[0-9a-f]{32}$/.test(attachment.riskIntentDigest)
        || !/^riskv_[0-9a-f]{32}$/.test(attachment.verdictDigest)) return false;

    const verdict = snapshotExactOwnDataRecord(attachment.verdict, VERDICT_KEYS);
    if (verdict === null) return false;
    const checkValues = snapshotDenseOwnDataArray(verdict.checks, 128);
    const blockingCodeValues = snapshotDenseOwnDataArray(verdict.blockingCodes, 128);
    const decisiveInput = snapshotExactOwnDataRecord(verdict.decisiveInputSnapshot, DECISIVE_INPUT_KEYS);
    const decisiveCheckValues = decisiveInput === null
      ? null
      : snapshotDenseOwnDataArray(decisiveInput.checks, 128);
    if (checkValues === null || checkValues.length === 0 || blockingCodeValues === null
        || decisiveInput === null || decisiveCheckValues === null) return false;
    const checks: Readonly<RiskCheck>[] = [];
    for (const checkValue of checkValues) {
      const check = snapshotRiskCheck(checkValue);
      if (check === null) return false;
      checks.push(check);
    }
    const decisiveChecks: Readonly<RiskCheck>[] = [];
    for (const checkValue of decisiveCheckValues) {
      const check = snapshotRiskCheck(checkValue);
      if (check === null) return false;
      decisiveChecks.push(check);
    }
    if (blockingCodeValues.some(
      (code) => typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(code),
    )) return false;
    const normalizedChecks = Object.freeze(checks);
    const normalizedBlockingCodes = Object.freeze(blockingCodeValues.map((code) => code as string));
    const normalizedDecisiveChecks = Object.freeze(decisiveChecks);
    const decision = verdict.decision;
    const maxAllowedSize = verdict.maxAllowedSize;
    if ((decision !== 'APPROVED' && decision !== 'REJECTED' && decision !== 'NEEDS_REVIEW')
        || typeof verdict.allowed !== 'boolean'
        || typeof verdict.requiredConfirmation !== 'boolean'
        || typeof verdict.correlationId !== 'string'
        || verdict.correlationId !== proposal.correlationId
        || (maxAllowedSize !== null
          && (typeof maxAllowedSize !== 'number'
            || !Number.isFinite(maxAllowedSize)
            || maxAllowedSize < 0
            || Object.is(maxAllowedSize, -0)))
        || Object.is(verdict.evaluatedAt, -0)
        || Object.is(verdict.expiresAt, -0)
        || Object.is(decisiveInput.evaluatedAt, -0)
        || !isValidUtcMillis(verdict.evaluatedAt)
        || !isValidUtcMillis(verdict.expiresAt)
        || decisiveInput.evaluatedAt !== verdict.evaluatedAt
        || verdict.evaluatedAt > now
        || verdict.evaluatedAt < proposal.updatedTs
        || verdict.evaluatedAt < proposal.featureObservedAtMs
        || verdict.expiresAt <= now
        || verdict.expiresAt > proposal.expiresAtMs) return false;
    const derivedBlockingCodes = normalizedChecks
      .filter((check) => check.blocking && check.status !== 'PASS')
      .map((check) => check.code);
    const expectedDecision = normalizedChecks.some((check) => check.blocking && check.status === 'FAIL')
      ? 'REJECTED'
      : normalizedChecks.some((check) => check.blocking && check.status === 'UNKNOWN')
        ? 'NEEDS_REVIEW'
        : 'APPROVED';
    const expectedDecisiveChecks = normalizedChecks.filter(
      (check) => check.blocking && (expectedDecision === 'APPROVED' || check.status !== 'PASS'),
    );
    if (decision !== expectedDecision
        || verdict.allowed !== (decision === 'APPROVED')
        || verdict.requiredConfirmation !== (decision === 'NEEDS_REVIEW')
        || (decision === 'APPROVED'
          ? typeof maxAllowedSize !== 'number' || expectedDecisiveChecks.length === 0
          : decision === 'REJECTED'
            ? maxAllowedSize !== 0
            : maxAllowedSize !== null)
        || derivedBlockingCodes.length !== normalizedBlockingCodes.length
        || derivedBlockingCodes.some((code, index) => code !== normalizedBlockingCodes[index])
        || expectedDecisiveChecks.length !== normalizedDecisiveChecks.length
        || expectedDecisiveChecks.some(
          (check, index) => !sameRiskCheck(check, normalizedDecisiveChecks[index]),
        )) return false;
    const normalizedVerdict = Object.freeze({
      correlationId: verdict.correlationId,
      decision,
      allowed: verdict.allowed,
      maxAllowedSize,
      requiredConfirmation: verdict.requiredConfirmation,
      decisiveInputSnapshot: Object.freeze({
        evaluatedAt: verdict.evaluatedAt,
        checks: normalizedDecisiveChecks,
      }),
      evaluatedAt: verdict.evaluatedAt,
      expiresAt: verdict.expiresAt,
      checks: normalizedChecks,
      blockingCodes: normalizedBlockingCodes,
    }) as Readonly<RiskVerdict>;
    try {
      if (verdictDigest(normalizedVerdict) !== attachment.verdictDigest) return false;
    } catch {
      return false;
    }

    const previous = proposal.riskResult;
    if (previous !== null) {
      if (previous.verdictDigest === attachment.verdictDigest
          && previous.riskIntentDigest === attachment.riskIntentDigest
          && previous.planId === attachment.planId
          && previous.canonicalProposalId === attachment.canonicalProposalId) return true;
      if (normalizedVerdict.evaluatedAt < previous.evaluatedAt
          || normalizedVerdict.evaluatedAt === previous.evaluatedAt
          || (!previous.allowed && normalizedVerdict.allowed)) return false;
    }

    const result: Readonly<VolumeFoundationRiskResult> = Object.freeze({
      owner: 'FOUNDATION_MULTI_LEG_RISK',
      proposalId: proposal.id,
      canonicalProposalId: attachment.canonicalProposalId,
      proposalRevision: proposal.proposalRevision,
      proposalDigest: proposal.proposalDigest,
      configurationRevision: proposal.configurationRevision,
      correlationId: proposal.correlationId,
      planId: attachment.planId,
      riskIntentDigest: attachment.riskIntentDigest,
      verdictDigest: attachment.verdictDigest,
      decision: normalizedVerdict.decision,
      allowed: normalizedVerdict.allowed,
      maxAllowedSize: normalizedVerdict.maxAllowedSize,
      requiredConfirmation: normalizedVerdict.requiredConfirmation,
      decisiveInputSnapshot: normalizedVerdict.decisiveInputSnapshot,
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
          verdictDigest: attachment.verdictDigest,
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
