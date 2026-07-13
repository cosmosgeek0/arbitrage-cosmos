import type { RuntimeListingMetadata } from '../../../intelligenceRuntime/universe/index.js';

export const BINANCE_INSTRUMENT_REGISTRY_SCHEMA = 'BINANCE_INSTRUMENT_REGISTRY_V1' as const;

export const BINANCE_INSTRUMENT_PRODUCTS = Object.freeze([
  'SPOT',
  'USD_M_PERPETUAL',
  'MARGIN',
] as const);

export type BinanceInstrumentProduct = (typeof BINANCE_INSTRUMENT_PRODUCTS)[number];
export type BinanceInstrumentEnvironment = 'PRODUCTION';

export interface ExactFilterDecimal {
  readonly raw: string;
  readonly canonical: string;
}

export type NormalizedFilterValue = ExactFilterDecimal | string | number | boolean | null;

export type NormalizedInstrumentFilterState =
  | 'ACTIVE'
  | 'BLOCKED_DISABLED'
  | 'BLOCKED_MALFORMED'
  | 'BLOCKED_UNSUPPORTED'
  | 'BLOCKED_CONTRADICTORY'
  | 'BLOCKED_DUPLICATE';

export interface NormalizedInstrumentFilter {
  readonly filterType: string;
  readonly state: NormalizedInstrumentFilterState;
  readonly reasonCodes: readonly string[];
  readonly values: Readonly<Record<string, NormalizedFilterValue>>;
  readonly sourceContentSha256: string;
  readonly privateTruthRequired: boolean;
  readonly dynamicReferenceRequired: boolean;
}

export type InstrumentNormalizationState =
  | 'READY_STATIC_ONLY'
  | 'BLOCKED_SOURCE'
  | 'BLOCKED_OWNER_TRUTH';

export interface BinanceInstrumentSpec {
  readonly schema: typeof BINANCE_INSTRUMENT_REGISTRY_SCHEMA;
  readonly product: BinanceInstrumentProduct;
  readonly environment: BinanceInstrumentEnvironment;
  readonly contractId: string;
  readonly symbol: string;
  readonly pair: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly status: string;
  readonly tradingAllowed: boolean | null;
  readonly contractType: string | null;
  readonly contractSize: null;
  readonly advertisedOrderTypes: readonly string[];
  readonly staticOrderTypes: readonly string[];
  readonly allowedTimeInForce: readonly string[];
  readonly permissionSets: readonly (readonly string[])[];
  readonly filters: readonly NormalizedInstrumentFilter[];
  readonly sourceMetadataId: string;
  readonly sourceAuthorityId: string;
  readonly sourceDataset: string;
  readonly sourceFingerprint: string;
  readonly sourceHashSha256: string;
  readonly sourceReceivedAtMs: number;
  readonly sourceMaximumAgeMs: number;
  readonly sourceValidUntilMs: number;
  readonly sourceEvidenceRevision: string;
  readonly normalizationState: InstrumentNormalizationState;
  readonly lossCodes: readonly string[];
  readonly instrumentRevision: string;
  readonly documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
}

export interface BinanceInstrumentRegistrySnapshot {
  readonly schema: typeof BINANCE_INSTRUMENT_REGISTRY_SCHEMA;
  readonly product: BinanceInstrumentProduct;
  readonly environment: BinanceInstrumentEnvironment;
  readonly contractId: string;
  readonly matrixSha256: string;
  readonly evaluatedAtMs: number;
  readonly maximumAgeMs: number;
  readonly registryRevision: string;
  readonly snapshotRevision: string;
  readonly instruments: readonly Readonly<BinanceInstrumentSpec>[];
  readonly documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
}

export interface NormalizeRuntimeInstrumentRegistryInput {
  readonly matrixSha256: unknown;
  readonly contractId: unknown;
  readonly product: unknown;
  readonly environment: unknown;
  readonly evaluatedAtMs: unknown;
  readonly maximumAgeMs: unknown;
  readonly metadata: unknown;
}

export type NormalizeRuntimeInstrumentRegistryResult =
  | { readonly ok: true; readonly snapshot: Readonly<BinanceInstrumentRegistrySnapshot> }
  | { readonly ok: false; readonly reasonCodes: readonly string[] };

export interface InstrumentSizingRequest {
  readonly symbol: unknown;
  readonly instrumentRevision: unknown;
  readonly side: unknown;
  readonly orderType: unknown;
  readonly timeInForce: unknown;
  readonly requestedPrice: unknown;
  readonly referencePrice: unknown;
  readonly requestedQuantity: unknown;
  readonly notionalAsset: unknown;
  readonly approvedNotional: unknown;
  readonly intendedExposure: unknown;
  readonly evaluatedAtMs: unknown;
}

export interface InstrumentSizingTransformation {
  readonly kind: 'MAX_QUANTITY_REDUCTION' | 'GRID_REDUCTION' | 'NOTIONAL_CEILING_REDUCTION';
  readonly from: string;
  readonly to: string;
  readonly filterType: string | null;
}

export const BINANCE_FILTER_REFERENCE_SCHEMA = 'BINANCE_FILTER_REFERENCE_EVIDENCE_V1' as const;

export interface BinanceFilterReferenceEvidence {
  readonly schema: typeof BINANCE_FILTER_REFERENCE_SCHEMA;
  readonly producer: 'INTELLIGENCE_RUNTIME';
  readonly product: BinanceInstrumentProduct;
  readonly symbol: string;
  readonly instrumentRevision: string;
  readonly kind: 'MARK_PRICE' | 'WEIGHTED_AVERAGE' | 'LAST_PRICE';
  readonly averagingWindowMins: number | null;
  readonly price: string;
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly sourceTruthId: string;
  readonly evidenceRevision: string;
  readonly documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
}

export interface InstrumentSizingResult {
  readonly schema: 'BINANCE_STATIC_FILTER_PREFLIGHT_V1';
  readonly staticState: 'PASS' | 'BLOCKED';
  readonly reasonCodes: readonly string[];
  readonly instrumentRevision: string | null;
  readonly sourceEvidenceRevision: string | null;
  readonly registryRevision: string | null;
  readonly snapshotRevision: string | null;
  readonly referenceEvidenceRevision: string | null;
  readonly evaluatedAtMs: number | null;
  readonly instrumentValidUntilMs: number | null;
  readonly referenceObservedAtMs: number | null;
  readonly referenceValidUntilMs: number | null;
  readonly notionalAsset: 'USDT' | null;
  readonly requestedPrice: string | null;
  readonly validationPrice: string | null;
  readonly requestedQuantity: string | null;
  readonly resultQuantity: string | null;
  readonly resultNotional: string | null;
  readonly effectiveNotionalCeiling: string | null;
  readonly transformations: readonly InstrumentSizingTransformation[];
  readonly externalRequirements: readonly string[];
  readonly canaryMaximumNotional: '10';
  readonly sendEligible: false;
  readonly documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
}

export const BINANCE_SPOT_ORDER_TIF_CAPABILITY_SCHEMA =
  'BINANCE_SPOT_ORDER_TIF_CAPABILITY_V1' as const;

export type BinanceSpotLimitTimeInForce = 'GTC' | 'IOC' | 'FOK';

/**
 * A non-sendable proof that one exact Spot LIMIT/TIF request was checked
 * against both the accepted documentary contract and one current L04 Runtime
 * instrument/filter snapshot. It does not widen the Runtime-owned
 * `allowedTimeInForce` field on BinanceInstrumentSpec.
 */
export interface BinanceSpotOrderTifCapability {
  readonly schema: typeof BINANCE_SPOT_ORDER_TIF_CAPABILITY_SCHEMA;
  readonly state: 'PASS';
  readonly reasonCodes: readonly [];
  readonly product: 'SPOT';
  readonly environment: 'PRODUCTION';
  readonly instrumentContractId: 'SPOT_EXCHANGE_INFO_FILTERS';
  readonly orderContractId: 'SPOT_ORDER_POST';
  readonly matrixSha256: string;
  readonly spotApiGitCommit: string;
  readonly restApiSha256: string;
  readonly enumsSha256: string;
  readonly documentaryRevision: string;
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly side: 'BUY' | 'SELL';
  readonly orderType: 'LIMIT';
  readonly timeInForce: BinanceSpotLimitTimeInForce;
  readonly instrumentRevision: string;
  readonly sourceEvidenceRevision: string;
  readonly registryRevision: string;
  readonly snapshotRevision: string;
  readonly referenceEvidenceRevision: string | null;
  readonly sourceReceivedAtMs: number;
  readonly sourceValidUntilMs: number;
  readonly evaluatedAtMs: number;
  readonly validUntilMs: number;
  readonly preflightRevision: string;
  readonly requestedPrice: string;
  readonly requestedQuantity: string;
  readonly resultQuantity: string;
  readonly resultNotional: string;
  readonly resolvedCapabilityGaps: readonly ['SPOT_TIME_IN_FORCE_UNAVAILABLE'];
  readonly remainingExternalRequirements: readonly string[];
  readonly capabilityRevision: string;
  readonly sendEligible: false;
  readonly documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY';
  readonly externalActionAuthorization: 'NONE';
  readonly actionAuthority: 'NONE_RECORD_ONLY';
}

export type BindBinanceSpotOrderTifCapabilityResult =
  | {
      readonly ok: true;
      readonly binding: Readonly<BinanceSpotOrderTifCapability>;
    }
  | {
      readonly ok: false;
      readonly reasonCodes: readonly string[];
    };

export interface WaitingInstrumentBinding {
  readonly symbol: unknown;
  readonly instrumentRevision: unknown;
  readonly sourceEvidenceRevision: unknown;
  readonly snapshotRevision: unknown;
  readonly evaluatedAtMs: unknown;
  readonly orderType: unknown;
  readonly timeInForce: unknown;
  readonly notionalAsset: unknown;
  readonly referenceEvidence: unknown;
}

export interface WaitingRevisionDecision {
  readonly state: 'CURRENT' | 'REVALIDATION_REQUIRED' | 'BLOCKED';
  readonly reasonCodes: readonly string[];
  readonly instrumentRevision: string | null;
  readonly sourceEvidenceRevision: string | null;
  readonly snapshotRevision: string | null;
  readonly referenceEvidenceRevision: string | null;
  readonly sendEligible: false;
  readonly externalActionAuthorization: 'NONE';
}

export type RuntimeInstrumentMetadata = RuntimeListingMetadata;
