import type {
  AllocationDecision,
  CapitalConsiderationMode,
  EligibilityStatus,
  ExactDecimal,
  NonNegativeDecimal,
  OpportunityConsiderationId,
  TruthMetadata,
} from '../contracts/index.js';
import type { KeyedExactAmount, PortfolioBudgetSnapshot } from '../budgets/index.js';
import type { CapitalBudgetPolicy } from '../contracts/index.js';

export const ECONOMIC_DIRECTIONS = ['HEDGED', 'LONG', 'SHORT', 'UNKNOWN'] as const;
export type EconomicDirection = (typeof ECONOMIC_DIRECTIONS)[number];

export interface AllocationPriority {
  /** Higher class is considered first; no score is calculated here. */
  readonly policyClass: number;
  readonly stableKey: string;
}

export interface AllocationCandidate {
  readonly considerationId: OpportunityConsiderationId;
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
  readonly opensNewPlan: boolean;
  readonly opensNewActivePosition: boolean;
  readonly conflictingConsiderationIds: readonly OpportunityConsiderationId[];
  readonly priority: Readonly<AllocationPriority>;
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
  readonly remainder: Readonly<AllocationBudgetRemainder>;
}
