import { types as utilTypes } from 'node:util';
import type {
  AccountEvidence,
  ApprovalEvidence,
  BorrowEvidence,
  CooldownEvidence,
  ExistingPlansEvidence,
  KillSwitchEvidence,
  MarketEvidence,
  PlanLegIntent,
  RiskEvaluationInput,
  RiskPolicy,
} from '../../foundation/risk/index.js';
import {
  deriveRiskIntentDigest,
  evaluateMultiLegRisk,
} from '../../foundation/risk/index.js';
import {
  canonicalJson,
  deriveCanonicalProposalId,
  derivePlanId,
  deriveSourceProposalId,
  isValidUtcMillis,
  stableHash128Hex,
  type RiskVerdict,
} from '../../foundation/contracts/index.js';
import type {
  VolumeFoundationRiskAttachmentInput,
  VolumeProposalRiskCut,
} from '../../engine/volume/types.js';
import type { UtcClock } from '../composition/types.js';

export interface ProductionVolumeRiskBinding {
  readonly sourceProposalId: string;
  readonly canonicalProposalId: string;
  readonly proposalRevision: number;
  readonly proposalDigest: string;
  readonly configurationRevision: string;
  readonly correlationId: string;
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly featureObservedAtMs: number;
  readonly updatedAtMs: number;
  readonly expiresAtMs: number;
  readonly planId: string;
}

export interface ProductionVolumeRiskIntentEvidence {
  readonly accountId: string;
  readonly legs: readonly Readonly<PlanLegIntent>[];
  readonly declaredMaxNakedDurationMs: number | null;
  readonly estimatedRequiredMarginUsd: number | null;
  readonly requiredBorrowUsd: number | null;
}

export interface ProductionVolumeRiskEvidenceCut {
  /** Exact echo prevents a provider from answering for another proposal cut. */
  readonly binding: Readonly<ProductionVolumeRiskBinding>;
  readonly intent: Readonly<ProductionVolumeRiskIntentEvidence>;
  readonly approval: Readonly<ApprovalEvidence> | null;
  readonly killSwitch: Readonly<KillSwitchEvidence> | null;
  readonly market: Readonly<MarketEvidence> | null;
  readonly account: Readonly<AccountEvidence> | null;
  readonly borrow: Readonly<BorrowEvidence> | null;
  readonly existingPlans: Readonly<ExistingPlansEvidence> | null;
  readonly cooldown: Readonly<CooldownEvidence> | null;
  readonly policy: Readonly<RiskPolicy>;
}

export interface ProductionVolumeRiskEvidenceOwner {
  readonly readRiskEvidence: (
    binding: Readonly<ProductionVolumeRiskBinding>,
  ) => Readonly<ProductionVolumeRiskEvidenceCut> | null;
}

export interface ProductionVolumeRiskRuntimePort {
  readonly readProposalRiskCut: (proposalId: string) => Readonly<VolumeProposalRiskCut> | null;
  readonly recordFoundationRiskResult: (
    input: Readonly<VolumeFoundationRiskAttachmentInput>,
  ) => boolean;
}

export type ProductionVolumeRiskResult = Readonly<
  | {
      state: 'NOT_CONFIGURED';
      reasonCodes: readonly ['VOLUME_RISK_EVIDENCE_OWNER_NOT_CONFIGURED'];
      verdict: null;
      verdictDigest: null;
    }
  | {
      state: 'PROPOSAL_UNAVAILABLE' | 'INPUT_REJECTED' | 'PROPOSAL_CUT_CHANGED';
      reasonCodes: readonly string[];
      verdict: null;
      verdictDigest: null;
    }
  | {
      state: 'EVALUATED';
      reasonCodes: readonly string[];
      verdict: Readonly<RiskVerdict>;
      verdictDigest: string;
    }
>;

export interface ProductionVolumeRiskPort {
  readonly evaluateAndAttach: (sourceProposalId: string) => ProductionVolumeRiskResult;
}

const EVIDENCE_KEYS = Object.freeze([
  'account',
  'approval',
  'binding',
  'borrow',
  'cooldown',
  'existingPlans',
  'intent',
  'killSwitch',
  'market',
  'policy',
]);
const BINDING_KEYS = Object.freeze([
  'canonicalProposalId',
  'configurationRevision',
  'correlationId',
  'direction',
  'expiresAtMs',
  'featureObservedAtMs',
  'planId',
  'proposalDigest',
  'proposalRevision',
  'sourceProposalId',
  'symbol',
  'updatedAtMs',
]);
const INTENT_KEYS = Object.freeze([
  'accountId',
  'declaredMaxNakedDurationMs',
  'estimatedRequiredMarginUsd',
  'legs',
  'requiredBorrowUsd',
]);
const MAX_EVIDENCE_DEPTH = 16;
const MAX_EVIDENCE_NODES = 50_000;
const MAX_EVIDENCE_ARRAY_LENGTH = 10_000;
const MAX_EVIDENCE_OBJECT_KEYS = 64;
const MAX_EVIDENCE_STRING_LENGTH = 10_000;
const MAX_EVIDENCE_CHARACTERS = 2_000_000;

type PlainData = null | boolean | number | string | readonly PlainData[] | PlainRecord;
interface PlainRecord extends Readonly<Record<string, PlainData>> {}

interface EvidenceSnapshotState {
  nodes: number;
  characters: number;
  readonly seen: WeakSet<object>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidEvidence(): never {
  throw new TypeError('Volume risk owner evidence must be bounded ordinary own data');
}

function isPrototypePollutionKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function snapshotEvidenceValue(
  value: unknown,
  state: EvidenceSnapshotState,
  depth = 0,
): PlainData {
  state.nodes += 1;
  if (state.nodes > MAX_EVIDENCE_NODES || depth > MAX_EVIDENCE_DEPTH) invalidEvidence();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) invalidEvidence();
    return value;
  }
  if (typeof value === 'string') {
    state.characters += value.length;
    if (value.length > MAX_EVIDENCE_STRING_LENGTH
        || state.characters > MAX_EVIDENCE_CHARACTERS) invalidEvidence();
    return value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value)) invalidEvidence();
  if (state.seen.has(value)) invalidEvidence();
  state.seen.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) invalidEvidence();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (typeof length !== 'number'
        || !Number.isSafeInteger(length)
        || length < 0
        || length > MAX_EVIDENCE_ARRAY_LENGTH) invalidEvidence();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || keys.some((key) => typeof key === 'symbol')) invalidEvidence();
    const out: PlainData[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) invalidEvidence();
      out.push(snapshotEvidenceValue(descriptor.value, state, depth + 1));
    }
    state.seen.delete(value);
    return Object.freeze(out);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidEvidence();
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_EVIDENCE_OBJECT_KEYS
      || keys.some((key) => typeof key === 'symbol'
        || isPrototypePollutionKey(key as string))) invalidEvidence();
  const out = Object.create(null) as Record<string, PlainData>;
  for (const key of keys as string[]) {
    if (key.length === 0 || key.length > 200) invalidEvidence();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) invalidEvidence();
    Object.defineProperty(out, key, {
      value: snapshotEvidenceValue(descriptor.value, state, depth + 1),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  state.seen.delete(value);
  return Object.freeze(out);
}

function exactPlainRecord(
  value: PlainData,
  expectedKeys: readonly string[],
): PlainRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const actual = Object.keys(value).sort(compareText);
  const expected = [...expectedKeys].sort(compareText);
  return actual.length === expected.length
      && actual.every((key, index) => key === expected[index])
    ? value as PlainRecord
    : null;
}

function snapshotVolumeRiskEvidenceCut(
  value: unknown,
): Readonly<ProductionVolumeRiskEvidenceCut> | null {
  try {
    const snapshot = snapshotEvidenceValue(value, {
      nodes: 0,
      characters: 0,
      seen: new WeakSet<object>(),
    });
    const evidence = exactPlainRecord(snapshot, EVIDENCE_KEYS);
    const binding = evidence === null ? null : exactPlainRecord(evidence.binding, BINDING_KEYS);
    const intent = evidence === null ? null : exactPlainRecord(evidence.intent, INTENT_KEYS);
    if (evidence === null || binding === null || intent === null || !Array.isArray(intent.legs)) return null;
    return evidence as unknown as Readonly<ProductionVolumeRiskEvidenceCut>;
  } catch {
    return null;
  }
}

function reasons(...values: string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

function failed(
  state: 'PROPOSAL_UNAVAILABLE' | 'INPUT_REJECTED' | 'PROPOSAL_CUT_CHANGED',
  ...reasonCodes: string[]
): ProductionVolumeRiskResult {
  return Object.freeze({
    state,
    reasonCodes: reasons(...reasonCodes),
    verdict: null,
    verdictDigest: null,
  });
}

function exactBinding(
  left: Readonly<ProductionVolumeRiskBinding>,
  right: Readonly<ProductionVolumeRiskBinding>,
): boolean {
  return left.sourceProposalId === right.sourceProposalId
    && left.canonicalProposalId === right.canonicalProposalId
    && left.proposalRevision === right.proposalRevision
    && left.proposalDigest === right.proposalDigest
    && left.configurationRevision === right.configurationRevision
    && left.correlationId === right.correlationId
    && left.symbol === right.symbol
    && left.direction === right.direction
    && left.featureObservedAtMs === right.featureObservedAtMs
    && left.updatedAtMs === right.updatedAtMs
    && left.expiresAtMs === right.expiresAtMs
    && left.planId === right.planId;
}

function bindingFromCut(cut: Readonly<VolumeProposalRiskCut>): Readonly<ProductionVolumeRiskBinding> {
  const sourceRecordId = deriveSourceProposalId({ source: 'VOLUME', engineKey: cut.proposalId });
  const canonicalProposalId = deriveCanonicalProposalId({
    source: 'VOLUME',
    sourceRecordId,
    symbol: cut.symbol,
  });
  return Object.freeze({
    sourceProposalId: cut.proposalId,
    canonicalProposalId,
    proposalRevision: cut.proposalRevision,
    proposalDigest: cut.proposalDigest,
    configurationRevision: cut.configurationRevision,
    correlationId: cut.correlationId,
    symbol: cut.symbol,
    direction: cut.direction,
    featureObservedAtMs: cut.featureObservedAtMs,
    updatedAtMs: cut.updatedTs,
    expiresAtMs: cut.expiresAtMs,
    planId: derivePlanId({ canonicalProposalId, attempt: 0 }),
  });
}

function completeProposalInput(
  binding: Readonly<ProductionVolumeRiskBinding>,
  evidence: Readonly<ProductionVolumeRiskEvidenceCut>,
  nowMs: number,
): Readonly<RiskEvaluationInput> | null {
  if (!exactBinding(evidence.binding, binding)) return null;
  if (!Array.isArray(evidence.intent.legs)
      || evidence.intent.legs.length === 0
      || evidence.intent.legs.some((leg) => leg.symbol !== binding.symbol)) return null;
  const expectedSpotSide = binding.direction === 'long' ? 'BUY' : 'SELL';
  const expectedPerpSide = binding.direction === 'long' ? 'SELL' : 'BUY';
  if (!evidence.intent.legs.some(
    (leg) => leg.venue === 'BINANCE_SPOT' && leg.side === expectedSpotSide,
  ) || !evidence.intent.legs.some(
    (leg) => leg.venue === 'BINANCE_USDM' && leg.side === expectedPerpSide,
  )) return null;

  const intent = Object.freeze({
    planId: binding.planId,
    accountId: evidence.intent.accountId,
    proposalRef: binding.canonicalProposalId,
    riskClass: 'RISK_INCREASING' as const,
    legs: evidence.intent.legs,
    declaredMaxNakedDurationMs: evidence.intent.declaredMaxNakedDurationMs,
    estimatedRequiredMarginUsd: evidence.intent.estimatedRequiredMarginUsd,
    requiredBorrowUsd: evidence.intent.requiredBorrowUsd,
  });
  let intentDigest: string;
  try {
    intentDigest = deriveRiskIntentDigest(intent);
  } catch {
    return null;
  }
  const maxAgeMs = binding.expiresAtMs - binding.featureObservedAtMs;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) return null;

  return Object.freeze({
    correlationId: binding.correlationId,
    nowMs,
    intent,
    proposal: Object.freeze({
      proposalId: binding.canonicalProposalId,
      entryIntentDigest: intentDigest,
      lifecycle: 'OPEN' as const,
      expiresAtMs: binding.expiresAtMs,
      observedAt: Object.freeze({
        sourceTimeMs: binding.featureObservedAtMs,
        receivedAtMs: nowMs,
        maxAgeMs,
        authority: 'DERIVED_LIVE' as const,
        completeness: 'COMPLETE' as const,
        sourceId: `volume.proposal.${binding.sourceProposalId}.${binding.proposalRevision}`,
      }),
    }),
    approval: evidence.approval,
    killSwitch: evidence.killSwitch,
    market: evidence.market,
    account: evidence.account,
    borrow: evidence.borrow,
    existingPlans: evidence.existingPlans,
    cooldown: evidence.cooldown,
    policy: evidence.policy,
  });
}

export function createProductionVolumeRiskPort(input: Readonly<{
  clock: UtcClock;
  runtime: Readonly<ProductionVolumeRiskRuntimePort>;
  owner: Readonly<ProductionVolumeRiskEvidenceOwner> | null;
}>): Readonly<ProductionVolumeRiskPort> {
  return Object.freeze({
    evaluateAndAttach(sourceProposalId: string): ProductionVolumeRiskResult {
      if (input.owner === null) {
        return Object.freeze({
          state: 'NOT_CONFIGURED',
          reasonCodes: Object.freeze(['VOLUME_RISK_EVIDENCE_OWNER_NOT_CONFIGURED'] as const),
          verdict: null,
          verdictDigest: null,
        });
      }
      if (typeof sourceProposalId !== 'string' || sourceProposalId.length === 0 || sourceProposalId.length > 128) {
        return failed('INPUT_REJECTED', 'SOURCE_PROPOSAL_ID_INVALID');
      }

      const nowMs = input.clock.nowMs();
      if (Object.is(nowMs, -0) || !isValidUtcMillis(nowMs)) {
        throw new TypeError('clock.nowMs returned invalid UTC ms');
      }
      const cut = input.runtime.readProposalRiskCut(sourceProposalId);
      if (cut === null || nowMs >= cut.expiresAtMs) {
        return failed('PROPOSAL_UNAVAILABLE', cut === null ? 'PROPOSAL_NOT_OPEN' : 'PROPOSAL_EXPIRED');
      }

      let binding: Readonly<ProductionVolumeRiskBinding>;
      let evidence: Readonly<ProductionVolumeRiskEvidenceCut> | null;
      try {
        binding = bindingFromCut(cut);
        evidence = input.owner.readRiskEvidence(binding);
      } catch {
        return failed('INPUT_REJECTED', 'VOLUME_RISK_EVIDENCE_READ_FAILED');
      }
      if (evidence === null) return failed('INPUT_REJECTED', 'VOLUME_RISK_EVIDENCE_UNAVAILABLE');
      const inspectedEvidence = snapshotVolumeRiskEvidenceCut(evidence);
      if (inspectedEvidence === null) {
        return failed('INPUT_REJECTED', 'VOLUME_RISK_EVIDENCE_BINDING_INVALID');
      }
      let riskInput: Readonly<RiskEvaluationInput> | null;
      try {
        riskInput = completeProposalInput(binding, inspectedEvidence, nowMs);
      } catch {
        riskInput = null;
      }
      if (riskInput === null) return failed('INPUT_REJECTED', 'VOLUME_RISK_EVIDENCE_BINDING_INVALID');

      let verdict: Readonly<RiskVerdict>;
      let riskIntentDigest: string;
      try {
        riskIntentDigest = deriveRiskIntentDigest(riskInput.intent);
        verdict = evaluateMultiLegRisk(riskInput);
      } catch {
        return failed('INPUT_REJECTED', 'FOUNDATION_RISK_INPUT_INVALID');
      }
      const verdictDigest = `riskv_${stableHash128Hex(
        `foundationRiskVerdict|${canonicalJson(verdict)}`,
      )}`;
      const attachment: Readonly<VolumeFoundationRiskAttachmentInput> = Object.freeze({
        expectedProposalId: binding.sourceProposalId,
        expectedProposalRevision: binding.proposalRevision,
        expectedProposalDigest: binding.proposalDigest,
        expectedConfigurationRevision: binding.configurationRevision,
        expectedCorrelationId: binding.correlationId,
        canonicalProposalId: binding.canonicalProposalId,
        planId: binding.planId,
        riskIntentDigest,
        verdict,
        verdictDigest,
      });
      let recorded = false;
      try {
        recorded = input.runtime.recordFoundationRiskResult(attachment);
      } catch {
        recorded = false;
      }
      if (!recorded) return failed('PROPOSAL_CUT_CHANGED', 'FOUNDATION_RISK_ATTACHMENT_REJECTED');

      return Object.freeze({
        state: 'EVALUATED',
        reasonCodes: reasons(...verdict.blockingCodes),
        verdict,
        verdictDigest,
      });
    },
  });
}
