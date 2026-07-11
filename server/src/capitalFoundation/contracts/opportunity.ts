import type { CanonicalProposal, StrategySource } from '../../foundation/contracts/index.js';
import type { ExactDecimal, NonNegativeDecimal } from './decimal.js';
import type {
  EvidencePacketId,
  OpportunityConsiderationId,
  StrategyProposalId,
} from './identity.js';
import type { CapitalTruthState, TruthMetadata } from './truth.js';

export const CAPITAL_CONSIDERATION_MODES = ['ADVISORY', 'VALIDATE_ONLY', 'MANUAL_ARMED'] as const;
export type CapitalConsiderationMode = (typeof CAPITAL_CONSIDERATION_MODES)[number];

export const ELIGIBILITY_STATUSES = ['ELIGIBLE', 'BLOCKED', 'ADVISORY'] as const;
export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

export const ELIGIBILITY_REASON_CODES = [
  'PROPOSAL_OPEN',
  'PROPOSAL_EXPIRED',
  'PROPOSAL_REJECTED',
  'PROPOSAL_INVALIDATED',
  'PROPOSAL_REVISION_UNKNOWN',
  'PROPOSAL_CONFIG_MISMATCH',
  'PROPOSAL_TRUTH_INCOMPLETE',
  'EVIDENCE_MISSING',
  'EVIDENCE_STALE',
  'EVIDENCE_DIVERGENT',
  'ACCOUNT_TRUTH_BLOCKED',
  'BORROW_TRUTH_BLOCKED',
  'CONFLICTING_OPPORTUNITY',
  'VOLUME_ADVISORY_ONLY',
  'VOLUME_CALIBRATION_BLOCKED',
  'EXECUTABLE_STRUCTURE_UNKNOWN',
  'CONSERVATIVE_ECONOMICS_INCOMPLETE',
] as const;
export type EligibilityReasonCode = (typeof ELIGIBILITY_REASON_CODES)[number];

export interface StrategyProposalReference {
  readonly sourceProposalId: StrategyProposalId;
  readonly canonicalProposalId: CanonicalProposal['canonicalId'];
  readonly sourceCorrelationId: string;
  readonly strategy: StrategySource;
  readonly symbol: string;
  readonly direction: string;
  readonly sourceLifecycle: string;
  readonly sourceRevision: string | null;
  readonly sourceConfigRevision: string | null;
  readonly createdAtMs: number | null;
  readonly updatedAtMs: number | null;
  readonly expiresAtMs: number | null;
  /** Content identity of the immutable intake copy, never an engine revision. */
  readonly intakeDigest: string;
}

export interface OpportunityLegIntent {
  readonly role: 'SPOT' | 'PERPETUAL' | 'DIRECTIONAL' | 'UNKNOWN';
  readonly instrumentId: string | null;
  readonly symbol: string;
  readonly side: 'LONG' | 'SHORT' | 'UNKNOWN';
  readonly borrowRequired: boolean | null;
}

export interface ConservativeEconomicInputs {
  readonly valuationAsset: string;
  readonly requestedCapital: NonNegativeDecimal | null;
  readonly expectedGrossEdge: ExactDecimal | null;
  readonly expectedNetEdge: ExactDecimal | null;
  readonly estimatedFees: NonNegativeDecimal | null;
  readonly estimatedFunding: ExactDecimal | null;
  readonly estimatedBorrowCost: NonNegativeDecimal | null;
  readonly estimatedSpreadCost: NonNegativeDecimal | null;
  readonly estimatedSlippage: NonNegativeDecimal | null;
  readonly liquidityCapacity: NonNegativeDecimal | null;
  readonly exactSourceIds: readonly string[];
  readonly missingFields: readonly string[];
}

export interface OpportunityConsideration {
  readonly id: OpportunityConsiderationId;
  readonly proposal: Readonly<StrategyProposalReference>;
  readonly mode: CapitalConsiderationMode;
  readonly status: EligibilityStatus;
  readonly reasons: readonly EligibilityReasonCode[];
  readonly legs: readonly Readonly<OpportunityLegIntent>[];
  readonly economics: Readonly<ConservativeEconomicInputs>;
  readonly evidencePacketIds: readonly EvidencePacketId[];
  readonly evidenceTruth: CapitalTruthState;
  readonly truth: Readonly<TruthMetadata>;
  readonly conflictingConsiderationIds: readonly OpportunityConsiderationId[];
  readonly evaluatedAtMs: number;
}

export interface ProposalIntakeLossReport {
  readonly omittedFields: readonly string[];
  readonly missingSourceFields: readonly string[];
  readonly translationReasons: readonly string[];
  readonly financialNumbersAccepted: false;
}

/**
 * Safe output of a compatibility adapter. The upstream canonical proposal is
 * never exposed directly because it permits floating edge/confidence fields.
 */
export interface ProposalIntakeRecord {
  readonly proposal: Readonly<StrategyProposalReference>;
  readonly economics: Readonly<ConservativeEconomicInputs>;
  readonly truth: Readonly<TruthMetadata>;
  readonly lossReport: Readonly<ProposalIntakeLossReport>;
}
