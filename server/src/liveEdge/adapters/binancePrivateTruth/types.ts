/**
 * Closed L05 private-evidence value contracts.
 *
 * These types describe injected evidence and pure projections only. No
 * interface exposes a credential, transport, private read, exchange mutation,
 * reconciliation decision, Capital/Risk verdict, persistence port or owner
 * runtime.
 */

import type {
  Completeness,
  DataAuthority,
  FreshnessReport,
} from '../../../foundation/contracts/index.js';

export const PRIVATE_PRODUCTS = Object.freeze(['SPOT', 'USD_M_PERPETUAL', 'MARGIN'] as const);
export type PrivateProduct = (typeof PRIVATE_PRODUCTS)[number];

export const PRIVATE_READ_STATES = Object.freeze([
  'OK', 'RATE_LIMITED', 'SOURCE_ERROR', 'UNAVAILABLE',
] as const);
export type PrivateReadState = (typeof PRIVATE_READ_STATES)[number];

export const PRIVATE_QUERY_SCOPES = Object.freeze([
  'ACCOUNT_WIDE', 'ALL_SYMBOLS', 'SYMBOL',
] as const);
export type PrivateQueryScope = (typeof PRIVATE_QUERY_SCOPES)[number];

export const PRIVATE_MARGIN_QUERY_MODES = Object.freeze([
  'CROSS', 'ISOLATED',
] as const);
export type PrivateMarginQueryMode = (typeof PRIVATE_MARGIN_QUERY_MODES)[number];

export const PRIVATE_MARGIN_INVENTORY_QUERY_TYPES = Object.freeze([
  'MARGIN', 'ISOLATED',
] as const);
export type PrivateMarginInventoryQueryType =
  (typeof PRIVATE_MARGIN_INVENTORY_QUERY_TYPES)[number];

export const PRIVATE_QUERY_COVERAGE_KINDS = Object.freeze([
  'UNAVAILABLE_GAP',
  'CURRENT_UNFILTERED',
  'HISTORY_EXPLICIT_WINDOW',
  'HISTORY_DEFAULT_PARTIAL',
  'HISTORY_CURSOR_PARTIAL',
] as const);
export type PrivateQueryCoverageKind = (typeof PRIVATE_QUERY_COVERAGE_KINDS)[number];

/**
 * Exact request/response coverage witness retained beside every private fact.
 * Null means that the corresponding optional exchange parameter was omitted;
 * it never means zero/default or "all". Historical default/cursor requests
 * may be recorded, but are intentionally incapable of complete evidence.
 */
export interface PrivateFactQueryCoverage {
  readonly kind: PrivateQueryCoverageKind;
  readonly omitZeroBalances: boolean | null;
  readonly startTimeMs: number | null;
  readonly endTimeMs: number | null;
  readonly limit: number | null;
  readonly orderId: string | null;
  readonly fromId: string | null;
  readonly cursor: string | null;
  readonly page: number | null;
  readonly size: number | null;
  readonly vipLevel: number | null;
  readonly isolatedSymbol: string | null;
  /** Exact optional Margin interest-history asset filter. */
  readonly asset: string | null;
}

export type PrivateTruthCompleteness = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
export type PrivateTruthPosture =
  | 'SPOT_NEW_EXPOSURE'
  | 'USDM_NEW_EXPOSURE'
  | 'SPOT_USDM_NEW_EXPOSURE'
  | 'MARGIN_NEW_EXPOSURE'
  | 'SUPERVISION_ONLY';

export const L05_PRIVATE_FACT_SCHEMA = 'L05_BINANCE_PRIVATE_FACT_V1' as const;
export const L05_PRIVATE_SOURCE_CUT_SCHEMA = 'L05_BINANCE_PRIVATE_SOURCE_CUT_V1' as const;
export const L05_PRIVATE_PROJECTION_SCHEMA = 'L05_BINANCE_PRIVATE_PROJECTION_V1' as const;
export const L05_PRIVATE_HANDOFF_SCHEMA = 'FOUNDATION_RECONCILIATION_COMPARISON_INPUT_V1' as const;
export const L05_PRIVATE_WAITING_SCHEMA = 'L05_PRIVATE_WAITING_BINDING_V1' as const;

/**
 * Fixed clock tolerance for timestamps embedded inside a current private REST
 * response. It is deliberately independent of caller-selected freshness.
 */
export const L05_PRIVATE_EMBEDDED_TIME_TOLERANCE_MS = 2_000 as const;

export const PRIVATE_FACT_KINDS = Object.freeze([
  'SPOT_PERMISSIONS', 'SPOT_ACCOUNT', 'SPOT_OPEN_ORDERS', 'SPOT_TRADES',
  'SPOT_COMMISSIONS', 'SPOT_ACCOUNT_STATUS', 'SPOT_TRADING_STATUS',
  'USDM_PERMISSIONS', 'USDM_ACCOUNT', 'USDM_BALANCE', 'USDM_POSITIONS',
  'USDM_OPEN_ORDERS', 'USDM_ALGO_OPEN_ORDERS', 'USDM_TRADES',
  'USDM_COMMISSIONS', 'USDM_INCOME',
  'USDM_ADL', 'USDM_ACCOUNT_CONFIGURATION', 'USDM_SYMBOL_CONFIGURATION',
  'USDM_ACCOUNT_STATUS', 'USDM_TRADING_STATUS',
  'USDM_MULTI_ASSETS_MODE', 'USDM_POSITION_MODE', 'MARGIN_PERMISSIONS',
  'MARGIN_CROSS_ACCOUNT', 'MARGIN_ISOLATED_ACCOUNT', 'MARGIN_OPEN_ORDERS',
  'MARGIN_TRADES', 'MARGIN_INTEREST', 'MARGIN_INTEREST_RATE',
  'MARGIN_INVENTORY', 'MARGIN_MAX_BORROWABLE', 'MARGIN_BORROW_REPAY_HISTORY',
  'MARGIN_ACCOUNT_STATUS', 'MARGIN_TRADING_STATUS',
] as const);
export type PrivateFactKind = (typeof PRIVATE_FACT_KINDS)[number];

export const PRIVATE_HISTORY_COVERAGE_FACT_KINDS = Object.freeze([
  'SPOT_TRADES', 'USDM_TRADES', 'MARGIN_TRADES',
  'MARGIN_INTEREST', 'MARGIN_INTEREST_RATE',
] as const satisfies readonly PrivateFactKind[]);
export type PrivateHistoryCoverageFactKind =
  (typeof PRIVATE_HISTORY_COVERAGE_FACT_KINDS)[number];

export const L05_PRIVATE_FACT_SCHEMA_REVISIONS: Readonly<
  Record<PrivateFactKind, string>
> = Object.freeze(Object.fromEntries(PRIVATE_FACT_KINDS.map((factKind) => (
  [factKind, factKind === 'USDM_ALGO_OPEN_ORDERS'
    ? 'L05_BINANCE_PRIVATE_USDM_ALGO_OPEN_ORDERS_V2'
    : `L05_BINANCE_PRIVATE_${factKind}_V1`]
))) as Record<PrivateFactKind, string>);

export const PRIVATE_TRUTH_POSTURES = Object.freeze([
  'SPOT_NEW_EXPOSURE', 'USDM_NEW_EXPOSURE', 'SPOT_USDM_NEW_EXPOSURE',
  'MARGIN_NEW_EXPOSURE', 'SUPERVISION_ONLY',
] as const satisfies readonly PrivateTruthPosture[]);

export const PRIVATE_PROFILE_CLASSES = Object.freeze(['READ_KEY', 'EXECUTION_KEY'] as const);
export type PrivateProfileClass = (typeof PRIVATE_PROFILE_CLASSES)[number];

export interface NoPrivateActionAuthority {
  readonly sendEligible: false;
  readonly accountReadAuthority: 'NONE';
  readonly mutationAuthority: 'NONE';
  readonly reconciliationAuthority: 'NONE';
  readonly capitalAuthority: 'NONE';
  readonly riskAuthority: 'NONE';
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
}

export const NO_PRIVATE_ACTION_AUTHORITY: Readonly<NoPrivateActionAuthority> = Object.freeze({
  sendEligible: false,
  accountReadAuthority: 'NONE',
  mutationAuthority: 'NONE',
  reconciliationAuthority: 'NONE',
  capitalAuthority: 'NONE',
  riskAuthority: 'NONE',
  externalActionAuthorization: 'NONE',
  actionAuthority: 'NONE_RECORD_ONLY',
});

export interface PrivateFactEvidenceInput {
  readonly schema: typeof L05_PRIVATE_FACT_SCHEMA;
  readonly matrixSha256: string;
  readonly factKind: PrivateFactKind;
  readonly product: PrivateProduct;
  readonly environment: 'PRODUCTION';
  readonly realm: string;
  readonly accountRealmId: string;
  readonly profileId: string | null;
  readonly contractId: string | null;
  readonly queryScope: PrivateQueryScope;
  readonly querySymbol: string | null;
  readonly queryAsset: string | null;
  readonly queryType: PrivateMarginInventoryQueryType | null;
  readonly marginMode: PrivateMarginQueryMode | null;
  readonly queryCoverage: Readonly<PrivateFactQueryCoverage>;
  readonly sourceId: string;
  readonly schemaRevision: string;
  readonly receiptId: string;
  readonly readState: PrivateReadState;
  readonly authority: DataAuthority;
  readonly completeness: Completeness;
  readonly sourceTimeMs: number | null;
  readonly receivedAtMs: number;
  readonly maxAgeMs: number;
  readonly value: unknown;
}

export interface NormalizedPrivateFact extends NoPrivateActionAuthority {
  readonly schema: typeof L05_PRIVATE_FACT_SCHEMA;
  readonly matrixSha256: string;
  readonly factKind: PrivateFactKind;
  readonly product: PrivateProduct;
  readonly environment: 'PRODUCTION';
  readonly realm: string;
  readonly accountRealmId: string;
  readonly profileId: string | null;
  readonly contractId: string | null;
  readonly queryScope: PrivateQueryScope;
  readonly querySymbol: string | null;
  readonly queryAsset: string | null;
  readonly queryType: PrivateMarginInventoryQueryType | null;
  readonly marginMode: PrivateMarginQueryMode | null;
  readonly queryCoverage: Readonly<PrivateFactQueryCoverage>;
  readonly sourceId: string;
  readonly schemaRevision: string;
  readonly receiptId: string;
  readonly readState: PrivateReadState;
  readonly authority: DataAuthority;
  readonly completeness: Completeness;
  readonly sourceTimeMs: number | null;
  readonly receivedAtMs: number;
  readonly maxAgeMs: number;
  /** Sanitized bounded raw value retained so downstream can re-run normalization. */
  readonly injectedValue: unknown;
  readonly value: unknown;
  readonly contentRevision: string;
  readonly evidenceRevision: string;
  readonly freshness: Readonly<FreshnessReport>;
  readonly validUntilMs: number | null;
  readonly usableAsPrivateEvidence: boolean;
  readonly contentBlockingCodes: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface PrivatePermissionPayload {
  readonly ipRestrict: boolean;
  readonly enableReading: boolean;
  readonly enableWithdrawals: boolean;
  readonly enableInternalTransfer: boolean;
  readonly enableMargin: boolean;
  readonly enableFutures: boolean;
  readonly permitsUniversalTransfer: boolean;
  readonly enableVanillaOptions: boolean;
  readonly enableFixApiTrade: boolean;
  readonly enableFixReadOnly: boolean;
  readonly enableSpotAndMarginTrading: boolean;
  readonly enablePortfolioMarginTrading: boolean;
}

export interface PrivatePermissionProfileInput {
  readonly profileClass: PrivateProfileClass;
  readonly profileId: string;
  readonly accountRealmId: string;
  readonly accountFingerprintRef: string;
  readonly environment: 'PRODUCTION';
  readonly deployedEgressMatch: boolean | null;
  readonly permissions: Readonly<PrivatePermissionPayload>;
  readonly accountStatus: 'Normal' | 'ABNORMAL' | 'UNKNOWN';
  readonly apiTradingLocked: boolean | null;
  readonly usdmDualSidePosition: boolean | null;
  readonly usdmMultiAssetsMargin: boolean | null;
  readonly marginMode: 'CROSS_CLASSIC' | 'ISOLATED' | 'UNKNOWN';
}

export interface PrivatePermissionDecision extends NoPrivateActionAuthority {
  readonly profileClass: PrivateProfileClass;
  readonly profileId: string;
  readonly accountRealmId: string;
  readonly accountFingerprintRef: string;
  readonly environment: 'PRODUCTION';
  readonly deployedEgressMatch: boolean | null;
  readonly permissions: Readonly<PrivatePermissionPayload>;
  readonly accountStatus: 'Normal' | 'ABNORMAL' | 'UNKNOWN';
  readonly apiTradingLocked: boolean | null;
  readonly usdmDualSidePosition: boolean | null;
  readonly usdmMultiAssetsMargin: boolean | null;
  readonly marginMode: 'CROSS_CLASSIC' | 'ISOLATED' | 'UNKNOWN';
  readonly posture: PrivateTruthPosture;
  readonly acceptableForOwnerReview: boolean;
  readonly reasonCodes: readonly string[];
  readonly revision: string;
}

export interface PrivateProductProjection {
  readonly product: PrivateProduct;
  readonly completeness: PrivateTruthCompleteness;
  readonly factKinds: readonly PrivateFactKind[];
  readonly contentRevisions: readonly string[];
  readonly evidenceRevisions: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface PrivateTruthProjection extends NoPrivateActionAuthority {
  readonly schema: typeof L05_PRIVATE_PROJECTION_SCHEMA;
  readonly matrixSha256: string;
  readonly posture: PrivateTruthPosture;
  readonly accountRealmId: string;
  readonly targetSymbol: string | null;
  readonly evaluatedAtMs: number;
  readonly sourceFacts: readonly Readonly<NormalizedPrivateFact>[];
  readonly permissions: readonly Readonly<PrivatePermissionDecision>[];
  /**
   * Injected Foundation-owner comparison requirements. These witnesses only
   * prove that the exact fact window matches an owner-declared requirement;
   * they do not let L05 choose a historical horizon or claim reconciliation.
   */
  readonly historyCoverageRequirements:
    readonly Readonly<PrivateHistoryCoverageRequirement>[];
  readonly reconciliationObservation: Readonly<PrivateLifecycleReconciliationObservation> | null;
  readonly validUntilMs: number | null;
  readonly spot: Readonly<PrivateProductProjection>;
  readonly futures: Readonly<PrivateProductProjection>;
  readonly margin: Readonly<PrivateProductProjection>;
  readonly completeness: PrivateTruthCompleteness;
  readonly entryEvidenceComplete: boolean;
  readonly reasonCodes: readonly string[];
  readonly semanticRevision: string;
  readonly evidenceRevision: string;
  readonly projectionRevision: string;
}

export interface PrivateHistoryCoverageRequirement {
  readonly owner: 'FOUNDATION_RECONCILIATION_HISTORY_COVERAGE';
  readonly status: 'EXACT_REQUIREMENT';
  readonly requirementRevision: string;
  readonly accountRealmId: string;
  readonly posture: PrivateTruthPosture;
  readonly targetSymbol: string;
  readonly factKind: PrivateHistoryCoverageFactKind;
  readonly factEvidenceRevision: string;
  readonly sourceCutRevision: string;
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly executionAuthority: 'NONE';
}

export interface PrivateLifecycleReconciliationObservation {
  readonly owner: 'FOUNDATION_RECONCILIATION';
  readonly status: 'EXACT';
  readonly resultRevision: string;
  readonly sourceCutRevision: string;
  /** Exact per-product lifecycle cuts covered by this Foundation result. */
  readonly productCutRevisions: Readonly<{
    readonly SPOT: string | null;
    readonly USD_M_PERPETUAL: string | null;
    readonly MARGIN: null;
  }>;
  readonly observedAtMs: number;
  readonly executionAuthority: 'NONE';
}

export interface PrivateLifecycleAuthority extends NoPrivateActionAuthority {
  readonly gapFreeSequenceProven: false;
  readonly runtimeWired: false;
}

export const PRIVATE_LIFECYCLE_AUTHORITY: Readonly<PrivateLifecycleAuthority> = Object.freeze({
  ...NO_PRIVATE_ACTION_AUTHORITY,
  gapFreeSequenceProven: false,
  runtimeWired: false,
});
