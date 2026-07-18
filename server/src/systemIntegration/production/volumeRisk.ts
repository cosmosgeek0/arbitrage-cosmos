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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
    legs: Object.freeze(evidence.intent.legs.map((leg) => Object.freeze({ ...leg }))),
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
      if (!isValidUtcMillis(nowMs)) throw new TypeError('clock.nowMs returned invalid UTC ms');
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
      let riskInput: Readonly<RiskEvaluationInput> | null;
      try {
        riskInput = completeProposalInput(binding, evidence, nowMs);
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
