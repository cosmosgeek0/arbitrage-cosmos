import type { BorrowTruth } from '../../foundation/borrow/index.js';
import type { SourcedTimestamp } from '../../foundation/contracts/index.js';
import type {
  CapitalTruthState,
  ExactDecimal,
  NonNegativeDecimal,
  TruthMetadata,
} from '../contracts/index.js';

export const ACCOUNT_SNAPSHOT_KEYS = [
  'spot',
  'futures',
  'liabilities',
  'orders',
  'plans',
  'reservations',
  'valuations',
  'hardReserves',
] as const;
export type AccountSnapshotKey = (typeof ACCOUNT_SNAPSHOT_KEYS)[number];

/**
 * Caller-supplied account cut identity. A coherent cut binds independently
 * read account facts to one reconciliation point; capitalPoolId identifies
 * the economic pool whose funds the snapshot can claim.
 */
export interface AccountSnapshotProvenance {
  readonly accountId: string;
  readonly capitalPoolId: string;
  readonly coherentCutId: string;
}

/** A caller-owned read snapshot. Null is explicit unknown, never an empty/zero fact. */
export interface AccountInputSnapshot<T> {
  readonly value: T | null;
  readonly provenance: Readonly<AccountSnapshotProvenance>;
  readonly source: Readonly<SourcedTimestamp>;
  readonly revision: string | null;
  readonly evidenceReferences: readonly string[];
  readonly reasons?: readonly string[];
  readonly divergent?: boolean;
}

export interface SpotBalanceInput {
  readonly asset: string;
  readonly total: NonNegativeDecimal;
  readonly available: NonNegativeDecimal;
  readonly locked: NonNegativeDecimal;
}

export interface DirectionalExposureInput {
  readonly positionId: string;
  readonly instrumentId: string;
  readonly valuationAsset: string;
  readonly longExposure: NonNegativeDecimal;
  readonly shortExposure: NonNegativeDecimal;
}

export interface SpotAccountInput {
  readonly balances: readonly Readonly<SpotBalanceInput>[];
  readonly positions: readonly Readonly<DirectionalExposureInput>[];
}

export interface FuturesWalletInput {
  readonly asset: string;
  readonly walletBalance: ExactDecimal;
  readonly availableBalance: NonNegativeDecimal;
  readonly marginBalance: ExactDecimal;
  readonly initialMargin: NonNegativeDecimal;
  readonly maintenanceMargin: NonNegativeDecimal;
}

export interface FuturesAccountInput {
  readonly wallets: readonly Readonly<FuturesWalletInput>[];
  readonly positions: readonly Readonly<DirectionalExposureInput>[];
}

export interface LiabilityInput {
  readonly liabilityId: string;
  readonly asset: string;
  readonly principal: NonNegativeDecimal;
  readonly accruedInterest: NonNegativeDecimal;
  readonly fees: NonNegativeDecimal;
  readonly total: NonNegativeDecimal;
}

export interface CapitalCommitmentInput {
  readonly commitmentId: string;
  /** Same group means the records represent the same capital and are de-duplicated by maximum amount. */
  readonly commitmentGroupId: string;
  readonly asset: string;
  readonly amount: NonNegativeDecimal;
  /** True when venue/account available balance has already excluded this commitment. */
  readonly reflectedInAvailable: boolean;
}

export interface ConservativeValuationInput {
  readonly asset: string;
  readonly valuationAsset: string;
  /** Caller-supplied conservative value of one unit of asset. */
  readonly conservativeUnitValue: NonNegativeDecimal | null;
  readonly reasonCodes: readonly string[];
}

export interface HardReserveInput {
  readonly reserveId: string;
  readonly asset: string;
  readonly amount: NonNegativeDecimal;
  readonly reasonCode: string;
}

export interface BorrowTruthReferenceInput {
  readonly referenceId: string;
  /** Canonical economic capacity pool; repeated evidence for one pool is never additive. */
  readonly capacityPoolId: string;
  readonly requiredForNewAllocation: boolean;
  /** Canonical Foundation truth is defensively cloned here but never re-derived. */
  readonly truth: Readonly<BorrowTruth>;
}

export interface DeriveAccountCapitalProjectionInput {
  readonly evaluatedAtMs: number;
  readonly valuationAsset: string;
  readonly spot: Readonly<AccountInputSnapshot<SpotAccountInput>>;
  readonly futures: Readonly<AccountInputSnapshot<FuturesAccountInput>>;
  readonly liabilities: Readonly<AccountInputSnapshot<readonly Readonly<LiabilityInput>[]>>;
  readonly orders: Readonly<AccountInputSnapshot<readonly Readonly<CapitalCommitmentInput>[]>>;
  readonly plans: Readonly<AccountInputSnapshot<readonly Readonly<CapitalCommitmentInput>[]>>;
  readonly reservations: Readonly<AccountInputSnapshot<readonly Readonly<CapitalCommitmentInput>[]>>;
  readonly valuations: Readonly<AccountInputSnapshot<readonly Readonly<ConservativeValuationInput>[]>>;
  readonly hardReserves: Readonly<AccountInputSnapshot<readonly Readonly<HardReserveInput>[]>>;
  readonly borrowTruthReferences: readonly Readonly<BorrowTruthReferenceInput>[];
}

export type ValuationStatus = 'NATIVE' | 'VALUED' | 'UNVALUED';

export interface AssetValuationProjection {
  readonly asset: string;
  readonly valuationAsset: string;
  readonly status: ValuationStatus;
  readonly conservativeUnitValue: NonNegativeDecimal | null;
  readonly reasonCodes: readonly string[];
}

export interface CollateralByAssetProjection {
  readonly asset: string;
  readonly spotTotal: NonNegativeDecimal;
  readonly spotAvailable: NonNegativeDecimal;
  readonly spotLocked: NonNegativeDecimal;
  readonly futuresWallet: ExactDecimal;
  readonly futuresAvailable: NonNegativeDecimal;
  readonly futuresMargin: ExactDecimal;
  readonly initialMargin: NonNegativeDecimal;
  readonly maintenanceMargin: NonNegativeDecimal;
  readonly totalCollateral: ExactDecimal;
  readonly availableCollateral: NonNegativeDecimal;
  readonly totalConservativeValue: ExactDecimal | null;
  readonly availableConservativeValue: NonNegativeDecimal | null;
  readonly valuation: Readonly<AssetValuationProjection>;
}

export interface LiabilityByAssetProjection {
  readonly asset: string;
  readonly principal: NonNegativeDecimal;
  readonly accruedInterest: NonNegativeDecimal;
  readonly fees: NonNegativeDecimal;
  readonly total: NonNegativeDecimal;
  readonly conservativeValue: NonNegativeDecimal | null;
  readonly liabilityIds: readonly string[];
  readonly valuation: Readonly<AssetValuationProjection>;
}

export interface CommitmentProjection {
  readonly commitmentId: string;
  readonly commitmentGroupId: string;
  readonly category: 'ORDER' | 'PLAN' | 'RESERVATION';
  readonly asset: string;
  readonly amount: NonNegativeDecimal;
  readonly reflectedInAvailable: boolean;
  readonly conservativeValue: NonNegativeDecimal | null;
}

export interface CommitmentSummaryProjection {
  readonly entries: readonly Readonly<CommitmentProjection>[];
  readonly orderValue: NonNegativeDecimal | null;
  readonly planValue: NonNegativeDecimal | null;
  readonly reservationValue: NonNegativeDecimal | null;
  /** Group-de-duplicated commitment not already reflected in available balance. */
  readonly incrementalValue: NonNegativeDecimal | null;
}

export interface HardReserveProjection {
  readonly reserveId: string;
  readonly asset: string;
  readonly amount: NonNegativeDecimal;
  readonly reasonCode: string;
  readonly conservativeValue: NonNegativeDecimal | null;
}

export interface ExposureProjection {
  readonly long: NonNegativeDecimal;
  readonly short: NonNegativeDecimal;
  readonly gross: NonNegativeDecimal;
  readonly netDirectional: ExactDecimal;
  readonly hedgeImbalance: NonNegativeDecimal;
  readonly activePositionCount: number;
}

export interface BorrowTruthReferenceProjection {
  readonly referenceId: string;
  readonly capacityPoolId: string;
  readonly requiredForNewAllocation: boolean;
  readonly current: boolean;
  readonly usableForNewAllocation: boolean;
  readonly maxBorrowableAsset: NonNegativeDecimal | null;
  readonly truth: Readonly<BorrowTruth>;
}

export interface BorrowCapacityByAssetProjection {
  readonly asset: string;
  readonly maxBorrowableAsset: NonNegativeDecimal;
  readonly conservativeValue: NonNegativeDecimal | null;
  readonly capacityPoolIds: readonly string[];
  readonly referenceIds: readonly string[];
}

export interface AccountTruthSummary {
  readonly completeness: CapitalTruthState;
  readonly allRequiredSourcesFreshAndComplete: boolean;
  readonly snapshotProvenance: Readonly<Record<AccountSnapshotKey, Readonly<AccountSnapshotProvenance>>>;
  readonly sourceTruth: Readonly<Record<AccountSnapshotKey, Readonly<TruthMetadata>>>;
  readonly reasons: readonly string[];
}

export type AllocatableStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

export interface AllocatableCapitalProjection {
  readonly status: AllocatableStatus;
  /** Null when truth is blocked; known exhaustion is the exact value zero. */
  readonly amount: NonNegativeDecimal | null;
  readonly valuationAsset: string;
  readonly availableCollateralValue: NonNegativeDecimal | null;
  readonly liabilityValue: NonNegativeDecimal | null;
  readonly incrementalCommitmentValue: NonNegativeDecimal | null;
  readonly hardReserveValue: NonNegativeDecimal | null;
  readonly unavailableReasons: readonly string[];
  readonly unknownReasons: readonly string[];
  readonly blockingReasons: readonly string[];
}

export interface AccountCapitalProjection {
  readonly evaluatedAtMs: number;
  readonly valuationAsset: string;
  readonly collateralByAsset: readonly Readonly<CollateralByAssetProjection>[];
  readonly liabilitiesByAsset: readonly Readonly<LiabilityByAssetProjection>[];
  readonly commitments: Readonly<CommitmentSummaryProjection>;
  readonly hardReserves: readonly Readonly<HardReserveProjection>[];
  readonly borrowTruthReferences: readonly Readonly<BorrowTruthReferenceProjection>[];
  /** Read-only capacity evidence; never counted as owned allocatable capital. */
  readonly borrowCapacityByAsset: readonly Readonly<BorrowCapacityByAssetProjection>[];
  readonly exposure: Readonly<ExposureProjection>;
  readonly truth: Readonly<AccountTruthSummary>;
  readonly allocatable: Readonly<AllocatableCapitalProjection>;
  /** Risk-reducing supervision remains visible even when new allocation is blocked. */
  readonly supervisionVisible: boolean;
}
