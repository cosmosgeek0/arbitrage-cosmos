import type {
  CapitalBudgetPolicy,
  CapitalTruthState,
  ExactDecimal,
  NonNegativeDecimal,
  TruthMetadata,
} from '../contracts/index.js';
import type { AccountCapitalProjection } from '../accountTruth/index.js';

export const COMMITMENT_KINDS = Object.freeze([
  'OPEN_ORDER',
  'ACTIVE_RESERVATION',
  'STAGED_PLAN',
  'PARTIALLY_EXPOSED_POSITION',
  'ACTIVE_POSITION',
] as const);
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
 * Exact partition proof for the one collateral pool that backs this budget
 * snapshot. Entry collateral and the protected risk-reduction reserve are
 * deliberately separate members of the partition; the validator binds both
 * top-level amounts plus this residual to the exact source-pool total.
 */
export interface CollateralPoolBinding {
  readonly sourcePoolId: string;
  readonly sourcePoolTotal: NonNegativeDecimal;
  readonly otherUnavailableCollateral: NonNegativeDecimal;
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
  readonly collateralPoolBinding: Readonly<CollateralPoolBinding>;
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

/**
 * Portfolio facts not owned by AccountTruth. The adapter derives account
 * collateral, reserve, borrow capacity, aggregate truth, and both count
 * fields; callers cannot restate those account-owned facts.
 */
export interface PortfolioBudgetFacts {
  readonly marginHeadroomAvailable: NonNegativeDecimal;
  readonly grossExposureAndCommitments: NonNegativeDecimal;
  readonly netDirectionalExposure: ExactDecimal;
  readonly strategyUse: readonly Readonly<KeyedExactAmount>[];
  readonly symbolUse: readonly Readonly<KeyedExactAmount>[];
  readonly correlatedGroupUse: readonly Readonly<KeyedExactAmount>[];
  readonly venueInstrumentUse: readonly Readonly<KeyedExactAmount>[];
  readonly liquidityCapacityByKey: readonly Readonly<KeyedExactAmount>[];
  readonly commitmentCoverage: Readonly<CommitmentCoverage>;
  readonly commitments: readonly Readonly<CapitalCommitmentReference>[];
}

export interface ProjectPortfolioBudgetSnapshotFromAccountInput {
  readonly accountProjection: Readonly<AccountCapitalProjection>;
  readonly portfolio: Readonly<PortfolioBudgetFacts>;
}

export interface AccountBoundBudgetSnapshotResult {
  readonly ok: boolean;
  /** Full content digest; also becomes the canonical collateral source-pool ID. */
  readonly accountProjectionDigest: string | null;
  readonly snapshot: Readonly<PortfolioBudgetSnapshot> | null;
  readonly reasonCodes: readonly string[];
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
