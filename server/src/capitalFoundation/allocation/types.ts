import type {
  AllocationDecision,
  CapitalConsiderationMode,
  EligibilityStatus,
  ExactDecimal,
  NonNegativeDecimal,
  OpportunityConsideration,
  OpportunityConsiderationId,
  TruthMetadata,
} from '../contracts/index.js';
import type { KeyedExactAmount, PortfolioBudgetSnapshot } from '../budgets/index.js';
import type { CapitalBudgetPolicy } from '../contracts/index.js';

export const ECONOMIC_DIRECTIONS = Object.freeze(['HEDGED', 'LONG', 'SHORT', 'UNKNOWN'] as const);
export type EconomicDirection = (typeof ECONOMIC_DIRECTIONS)[number];

/** Content integrity for the complete upstream consideration plus sizing geometry. */
export interface AllocationSizingAuthority {
  readonly revision: string;
  readonly sourceId: string;
}

export interface AllocationCandidate {
  readonly consideration: Readonly<OpportunityConsideration>;
  readonly considerationId: OpportunityConsiderationId;
  readonly considerationDigest: string;
  readonly eligibilityPolicyRevision: string;
  readonly sizingAuthority: Readonly<AllocationSizingAuthority>;
  readonly eligibilityStatus: EligibilityStatus;
  readonly considerationMode: CapitalConsiderationMode;
  readonly truth: Readonly<TruthMetadata>;
  readonly strategy: 'BASIS' | 'VOLUME';
  readonly valuationAsset: string;
  readonly primarySymbol: string;
  readonly economicDirection: EconomicDirection;
  readonly requestedAmount: NonNegativeDecimal;
  readonly grossExposureIncrease: NonNegativeDecimal;
  readonly netDirectionalExposureDelta: ExactDecimal;
  readonly collateralRequired: NonNegativeDecimal;
  readonly marginRequired: NonNegativeDecimal;
  readonly strategyRequirements: readonly Readonly<KeyedExactAmount>[];
  readonly symbolRequirements: readonly Readonly<KeyedExactAmount>[];
  readonly correlatedGroupRequirements: readonly Readonly<KeyedExactAmount>[];
  readonly venueInstrumentRequirements: readonly Readonly<KeyedExactAmount>[];
  readonly borrowRequired: boolean | null;
  readonly borrowRequirements: readonly Readonly<KeyedExactAmount>[];
  readonly liquidityRequirements: readonly Readonly<KeyedExactAmount>[];
  readonly conflictingConsiderationIds: readonly OpportunityConsiderationId[];
}

export interface AllocationBatchInput {
  readonly policy: Readonly<CapitalBudgetPolicy>;
  readonly snapshot: Readonly<PortfolioBudgetSnapshot>;
  readonly candidates: readonly Readonly<AllocationCandidate>[];
  readonly nowMs: number;
}

export interface AllocationBudgetRemainder {
  readonly grossExposureAndCommitments: NonNegativeDecimal;
  readonly netDirectionalExposure: ExactDecimal;
  readonly entryCollateralAvailable: NonNegativeDecimal;
  readonly marginHeadroomAvailable: NonNegativeDecimal;
  readonly strategyUse: readonly Readonly<KeyedExactAmount>[];
  readonly symbolUse: readonly Readonly<KeyedExactAmount>[];
  readonly correlatedGroupUse: readonly Readonly<KeyedExactAmount>[];
  readonly venueInstrumentUse: readonly Readonly<KeyedExactAmount>[];
  readonly borrowCapacityByAsset: readonly Readonly<KeyedExactAmount>[];
  readonly liquidityCapacityByKey: readonly Readonly<KeyedExactAmount>[];
  readonly concurrentPlans: number;
  readonly activePositions: number;
}

export interface AllocationBatchResult {
  readonly decisions: readonly Readonly<AllocationDecision>[];
  readonly authorities: readonly Readonly<AllocationAuthorityReceipt>[];
  readonly remainder: Readonly<AllocationBudgetRemainder>;
}

/**
 * Unkeyed, content-bound replay-integrity receipt emitted by the allocator for
 * one decision. It prevents a caller-recomputed decision ID from hiding input
 * drift, but it is deliberately not a signature or proof of issuer identity.
 * Authentic policy delivery belongs to a future trusted adapter; today the
 * content-addressed CapitalBudgetPolicy revision prevents semantic widening
 * under a retained revision.
 */
export interface AllocationAuthorityReceipt {
  readonly allocationDecisionId: AllocationDecision['id'];
  readonly considerationId: OpportunityConsiderationId;
  readonly decisionDigest: string;
  readonly policyRevision: CapitalBudgetPolicy['authority']['revision'];
  readonly policyDigest: string;
  readonly snapshotDigest: string;
  readonly candidateDigest: string;
  readonly batchCandidateDigests: readonly string[];
  readonly decidedAtMs: number;
  /** Exclusive validity boundary derived from policy plus both truth sources. */
  readonly validUntilMs: number | null;
  readonly digest: string;
}
