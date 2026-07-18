import type { FreshnessReport, SourcedTimestamp } from '../contracts/index.js';

/** Exhaustive operator states for one read-only margin-borrow decision. */
export const BORROW_TRUTH_STATES = [
  'AVAILABLE',
  'UNAVAILABLE',
  'UNKNOWN',
  'STALE',
  'PERMISSION_MISSING',
  'ACCOUNT_MODE_MISMATCH',
  'RATE_LIMITED',
  'SOURCE_ERROR',
] as const;
export type BorrowTruthState = (typeof BORROW_TRUTH_STATES)[number];

/** Binance cross-classic/cross-pro identity is kept distinct from isolated margin. */
export const MARGIN_ACCOUNT_MODES = ['CROSS_CLASSIC', 'CROSS_PRO', 'ISOLATED'] as const;
export type MarginAccountMode = (typeof MARGIN_ACCOUNT_MODES)[number];

/** Result of the adapter's read attempt. This lane never performs that read. */
export const BORROW_READ_STATUSES = ['OK', 'RATE_LIMITED', 'SOURCE_ERROR', 'UNAVAILABLE'] as const;
export type BorrowReadStatus = (typeof BORROW_READ_STATUSES)[number];

/** Collateral evidence admitted by this owner is margin-account scoped only. */
export const BORROW_COLLATERAL_PRODUCTS = ['MARGIN_ACCOUNT'] as const;
export type BorrowCollateralProduct = (typeof BORROW_COLLATERAL_PRODUCTS)[number];

export interface BorrowScopeIdentity {
  /** Internal account identity, never an API credential. */
  accountId: string;
  /** Trading pair whose margin account/scope is being evaluated. */
  symbol: string;
  /** Borrowed asset within the pair/account. */
  asset: string;
  /** Exact account mode represented by every evidence item. */
  mode: MarginAccountMode;
  /** Non-secret fingerprint/name of the permission snapshot used. */
  permissionId: string;
}

export interface BorrowReadEvidenceBase extends BorrowScopeIdentity {
  status: BorrowReadStatus;
  observedAt: SourcedTimestamp;
}

/**
 * Normalized account evidence.
 *
 * Cross adapters map `created`, the effective cross-account enabled posture,
 * and account-level `borrowEnabled` here. Isolated adapters map
 * `isolatedCreated`, row `enabled`, and the target asset's `borrowEnabled`.
 */
export interface BorrowAccountEvidence extends BorrowReadEvidenceBase {
  accountCreated: boolean | null;
  modeEnabled: boolean | null;
  borrowEnabled: boolean | null;
}

/** Read/key permission posture; null is unknown, never an implied false. */
export interface BorrowPermissionEvidence extends BorrowReadEvidenceBase {
  enableReading: boolean | null;
  enableMargin: boolean | null;
  enableSpotAndMarginTrading: boolean | null;
}

/** Exact strings from the max-borrow read endpoint, before any display rounding. */
export interface MaxBorrowEvidence extends BorrowReadEvidenceBase {
  amount: string | null;
  borrowLimit: string | null;
}

/** Exact future-hour interest-rate evidence. Optional for availability truth. */
export interface BorrowRateEvidence extends BorrowReadEvidenceBase {
  hourlyRate: string | null;
}

/**
 * Exact current liability evidence for the scoped borrowed asset.
 *
 * Binance margin account reads publish current `borrowed` and accrued
 * `interest` as separate values. They stay separate here: neither field is
 * derived from total debt and neither is converted through binary numbers.
 */
export interface BorrowLiabilityEvidence extends BorrowReadEvidenceBase {
  currentBorrowedAsset: string | null;
  accruedInterestAsset: string | null;
}

/**
 * Optional same-product collateral/LTV evidence supplied by an authorized
 * private adapter and bound to the exact margin decision scope.
 *
 * Binance margin account collateral margin level is not LTV and cannot be
 * relabelled or algebraically converted into `currentLtv`. Flexible-loan
 * collateral/LTV has a distinct product/loan identity and is not admissible
 * here. If a future same-scope owner supplies a venue-published LTV, it uses a
 * fractional exact string (`0.57` means 57%); otherwise the field stays null.
 */
export interface BorrowCollateralEvidence extends BorrowReadEvidenceBase {
  product: BorrowCollateralProduct;
  collateralAmount: string | null;
  collateralAsset: string | null;
  currentLtv: string | null;
}

export interface DeriveBorrowTruthInput {
  scope: BorrowScopeIdentity;
  /** Injected clock; no wall-clock access occurs in this lane. */
  nowMs: number;
  account: BorrowAccountEvidence | null;
  permission: BorrowPermissionEvidence | null;
  maxBorrow: MaxBorrowEvidence | null;
  rate: BorrowRateEvidence | null;
  liability: BorrowLiabilityEvidence | null;
  collateral: BorrowCollateralEvidence | null;
}

export type BorrowTruthReason =
  | 'BORROW_AMOUNT_POSITIVE'
  | 'BORROW_AMOUNT_ZERO'
  | 'BORROW_DISABLED'
  | 'ACCOUNT_NOT_CREATED'
  | 'ACCOUNT_MODE_DISABLED'
  | 'MODE_IDENTITY_MISMATCH'
  | 'PERMISSION_IDENTITY_MISMATCH'
  | 'MARGIN_PERMISSION_DISABLED'
  | 'PERMISSION_UNKNOWN'
  | 'ACCOUNT_STATUS_UNKNOWN'
  | 'BORROW_AMOUNT_UNKNOWN'
  | 'CURRENT_BORROW_UNKNOWN'
  | 'ACCRUED_INTEREST_UNKNOWN'
  | 'REQUIRED_EVIDENCE_MISSING'
  | 'EVIDENCE_PARTIAL'
  | 'EVIDENCE_EXPIRED'
  | 'EVIDENCE_CLOCK_SKEWED'
  | 'EVIDENCE_IDENTITY_MISMATCH'
  | 'SOURCE_RATE_LIMITED'
  | 'SOURCE_REPORTED_ERROR'
  | 'SOURCE_UNAVAILABLE';

export interface BorrowEvidenceProvenance {
  account: Readonly<SourcedTimestamp> | null;
  permission: Readonly<SourcedTimestamp> | null;
  maxBorrow: Readonly<SourcedTimestamp> | null;
  rate: Readonly<SourcedTimestamp> | null;
  liability: Readonly<SourcedTimestamp> | null;
  collateral: Readonly<SourcedTimestamp> | null;
}

export interface BorrowFreshnessEvidence {
  account: Readonly<FreshnessReport> | null;
  permission: Readonly<FreshnessReport> | null;
  maxBorrow: Readonly<FreshnessReport> | null;
  rate: Readonly<FreshnessReport> | null;
  liability: Readonly<FreshnessReport> | null;
  collateral: Readonly<FreshnessReport> | null;
}

/** Immutable, deterministic truth projection. Decimal values remain exact strings. */
export interface BorrowTruth extends BorrowScopeIdentity {
  state: BorrowTruthState;
  reason: BorrowTruthReason;
  positionBucket: 'MARGIN_CROSS' | 'MARGIN_ISOLATED';
  maxBorrowableAsset: string | null;
  borrowLimitAsset: string | null;
  hourlyRate: string | null;
  currentBorrowedAsset: string | null;
  accruedInterestAsset: string | null;
  collateralAmount: string | null;
  collateralAsset: string | null;
  currentLtv: string | null;
  evaluatedAtMs: number;
  /** Earliest expiry across supplied required preflight evidence, inclusive at the exact boundary. */
  expiresAtMs: number | null;
  provenance: Readonly<BorrowEvidenceProvenance>;
  freshness: Readonly<BorrowFreshnessEvidence>;
}
