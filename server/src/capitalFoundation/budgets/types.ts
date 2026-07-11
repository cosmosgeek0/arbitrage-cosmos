import type {
  CapitalBudgetPolicy,
  CapitalTruthState,
  ExactDecimal,
  NonNegativeDecimal,
  TruthMetadata,
} from '../contracts/index.js';

export const COMMITMENT_KINDS = [
  'OPEN_ORDER',
  'ACTIVE_RESERVATION',
  'STAGED_PLAN',
  'PARTIALLY_EXPOSED_POSITION',
  'ACTIVE_POSITION',
] as const;
export type CommitmentKind = (typeof COMMITMENT_KINDS)[number];

export interface CapitalCommitmentReference {
  readonly id: string;
  /** One economic claim may have only one current owner. */
  readonly capitalClaimKey: string;
  readonly kind: CommitmentKind;
}

export interface KeyedExactAmount {
  readonly key: string;
  readonly amount: NonNegativeDecimal;
}

export interface CommitmentCoverage {
  readonly orders: CapitalTruthState;
  readonly reservations: CapitalTruthState;
  readonly plans: CapitalTruthState;
  readonly partiallyExposedPositions: CapitalTruthState;
  readonly activePositions: CapitalTruthState;
}

/**
 * Caller-owned, already-reconciled budget projection. Capacity values are
 * remaining after existing claims. Usage values include exposure plus every
 * unentered commitment, so reservations/orders cannot disappear from limits.
 */
export interface PortfolioBudgetSnapshot {
  readonly valuationAsset: string;
  readonly truth: Readonly<TruthMetadata>;
  readonly entryCollateralAvailable: NonNegativeDecimal;
  readonly protectedRiskReductionReserve: NonNegativeDecimal;
  readonly marginHeadroomAvailable: NonNegativeDecimal;
  readonly grossExposureAndCommitments: NonNegativeDecimal;
  readonly netDirectionalExposure: ExactDecimal;
  readonly strategyUse: readonly Readonly<KeyedExactAmount>[];
  readonly symbolUse: readonly Readonly<KeyedExactAmount>[];
  readonly correlatedGroupUse: readonly Readonly<KeyedExactAmount>[];
  readonly venueInstrumentUse: readonly Readonly<KeyedExactAmount>[];
  readonly currentConcurrentPlans: number;
  readonly currentActivePositions: number;
  readonly borrowCapacityByAsset: readonly Readonly<KeyedExactAmount>[];
  readonly liquidityCapacityByKey: readonly Readonly<KeyedExactAmount>[];
  readonly commitmentCoverage: Readonly<CommitmentCoverage>;
  readonly commitments: readonly Readonly<CapitalCommitmentReference>[];
}

export interface BudgetValidation {
  readonly valid: boolean;
  readonly reasonCodes: readonly string[];
}

export interface ValidatedBudgetContext {
  readonly policy: Readonly<CapitalBudgetPolicy>;
  readonly snapshot: Readonly<PortfolioBudgetSnapshot>;
  readonly validatedAtMs: number;
}
