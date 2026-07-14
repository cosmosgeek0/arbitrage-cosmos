/**
 * L02 data-only vocabulary for dated Binance documentation contracts.
 *
 * These records describe external documentation. They do not expose a client,
 * credential, signing primitive, socket, account read, or mutation command.
 */

import type { ProductFamily } from '../../../intelligenceFoundation/contracts/index.js';

export const BINANCE_CONTRACT_MATRIX_SCHEMA = 'BINANCE_CONTRACT_MATRIX_V1' as const;
export const BINANCE_CONTRACT_MATRIX_REVISION = 'L02-BINANCE-2026-07-12' as const;
export const BINANCE_CONTRACT_MATRIX_CHECKED_AT = '2026-07-12T06:22:55Z' as const;

// Reuse the canonical ProductFamily spellings from Intelligence Foundation.
// The local closed subset avoids importing or duplicating that owner's logic.
export const BINANCE_PRODUCTS = ['SPOT', 'USD_M_PERPETUAL', 'MARGIN'] as const satisfies readonly ProductFamily[];
export const BINANCE_ENVIRONMENTS = ['PRODUCTION', 'DEMO', 'TESTNET'] as const;
export const BINANCE_REALMS = [
  'PUBLIC_REST',
  'PUBLIC_MARKET',
  'PRIVATE_USER_DATA',
  'PRIVATE_ACCOUNT',
  'PRIVATE_TRADE',
  'PRIVATE_RISK_DATA',
  'PRIVATE_MARGIN_ACCOUNT',
] as const;
export const BINANCE_TRANSPORTS = ['REST', 'WEBSOCKET_API', 'WEBSOCKET_STREAM'] as const;
export const BINANCE_LIFECYCLES = [
  'CURRENT',
  'REMOVED',
  'OFFICIAL_DOC_CONFLICT',
  'NOT_APPLICABLE',
  'UNKNOWN',
] as const;
export const BINANCE_OPERATION_KINDS = ['BASE', 'REST_PATH', 'WS_METHOD', 'WS_PATH'] as const;
export const BINANCE_HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
export const BINANCE_SECURITY_TYPES = [
  'NONE',
  'MIXED_BY_ENDPOINT',
  'USER_STREAM',
  'USER_DATA',
  'TRADE',
  'MARKET_DATA',
  'SESSION_AUTHENTICATED',
  'API_KEY_SIGNATURE',
  'LISTEN_KEY',
  'LISTEN_TOKEN',
  'UNKNOWN',
] as const;
export const BINANCE_KEY_TYPES = ['HMAC', 'RSA', 'ED25519'] as const;
export const BINANCE_SIGNING_ALGORITHMS = [
  'NONE',
  'HMAC_SHA256',
  'HMAC_RSA',
  'HMAC_RSA_ED25519',
  'ED25519_SESSION',
  'UNKNOWN',
] as const;
export const BINANCE_ENCODINGS = [
  'NOT_APPLICABLE',
  'PERCENT_ENCODE_BEFORE_SIGNING',
  'TOTAL_PARAMS_QUERY_THEN_BODY',
  'WS_SORTED_PARAMS',
  'UNKNOWN',
] as const;
export const BINANCE_TIMESTAMP_UNITS = [
  'NOT_APPLICABLE',
  'MILLISECONDS',
  'MILLISECONDS_OR_MICROSECONDS',
  'UNKNOWN',
] as const;
export const BINANCE_RATE_STATES = ['VERIFIED', 'UNKNOWN', 'OFFICIAL_DOC_CONFLICT'] as const;
export const BINANCE_RATE_KINDS = [
  'REQUEST_WEIGHT',
  'ORDER_COUNT',
  'CONNECTION_ATTEMPT',
  'MESSAGE_LIMIT',
  'SUBSCRIPTION_LIMIT',
] as const;
export const BINANCE_RATE_SCOPES = ['IP', 'UID', 'ACCOUNT', 'CONNECTION', 'UNKNOWN'] as const;
export const BINANCE_RATE_INTERVALS = [
  'REQUEST',
  'SECOND',
  'TEN_SECONDS',
  'MINUTE',
  'FIVE_MINUTES',
  'DAY',
  'CONNECTION_LIFETIME',
  'UNKNOWN',
] as const;
export const BINANCE_RATE_CONDITIONS = [
  'ALWAYS',
  'CATALOG_SCOPE_LABEL_BORROW_SIDE_EFFECT',
  'CATALOG_SCOPE_LABEL_DEFAULT',
  'CATALOG_VALUE_UNIT_BORROW_SIDE_EFFECT',
  'CATALOG_VALUE_UNIT_DEFAULT',
  'COMPUTE_COMMISSION_RATES_TRUE',
  'DEFAULT',
  'FAILED',
  'INCOMING_CONTROL_MESSAGES',
  'LIMIT_100',
  'LIMIT_1000',
  'LIMIT_500',
  'LIMIT_5_10_20_50',
  'SESSION_LIFETIME_TOTAL',
  'SIMULTANEOUS_ACTIVE',
  'SIMULTANEOUS_STREAMS',
  'SUCCESS',
  'WITHOUT_ORDER_ID',
  'WITHOUT_SYMBOL',
  'WITH_ORDER_ID',
  'WITH_SYMBOL',
] as const;
export const BINANCE_DATA_SOURCES = [
  'PUBLIC_DOCUMENTATION',
  'WEBSOCKET_EVENT_STREAM',
  'MATCHING_ENGINE_OR_UNKNOWN',
  'MATCHING_ENGINE',
  'MEMORY',
  'MEMORY_THEN_DATABASE',
  'DATABASE',
  'UNKNOWN_CURRENT_OFFICIAL_CATALOG',
  'NOT_APPLICABLE',
  'UNKNOWN',
] as const;
export const BINANCE_MUTATION_CLASSES = [
  'SOURCE_METADATA_ONLY',
  'PRIVATE_STREAM_CONTROL',
  'PRIVATE_ACCOUNT_READ',
  'ORDER_QUERY_READ',
  'PERMISSION_READ',
  'ORDER_MUTATION',
  'TEST_ORDER_MUTATION',
  'ORDER_CANCEL_MUTATION',
  'MARGIN_MUTATION',
] as const;
export const BINANCE_AMBIGUITY_CLASSES = [
  'NONE',
  'EXECUTION_STATUS_UNKNOWN',
  'OFFICIAL_DOC_CONFLICT',
  'UNKNOWN',
] as const;
export const BINANCE_SAFE_RETRY_CLASSES = [
  'NOT_APPLICABLE',
  'RECONCILE_BEFORE_RETRY',
  'RECREATE_AFTER_NOT_FOUND',
  'NEVER_AUTOMATIC',
  'UNKNOWN',
] as const;
export const BINANCE_RESPONSE_SCHEMA_STATES = ['PINNED', 'UNKNOWN'] as const;
export const BINANCE_ACTION_AUTHORITIES = ['NONE_RECORD_ONLY'] as const;
export const BINANCE_DOCUMENTARY_AUTHORITIES = ['DOCUMENTARY_EVIDENCE_ONLY'] as const;
export const BINANCE_EXTERNAL_ACTION_AUTHORIZATIONS = ['NONE'] as const;
export const BINANCE_DIGEST_SCOPES = ['CANONICAL_EVIDENCE_SET'] as const;
export const BINANCE_SOURCE_CONTENT_DIGEST_SCOPES = [
  'PINNED_GIT_FILE',
  'RAW_OFFICIAL_MARKDOWN',
  'NOT_CAPTURED',
] as const;
export const BINANCE_AUTHENTICATION_POLICIES = [
  'PUBLIC_NONE',
  'MIXED_SPOT',
  'SPOT_USER_DATA',
  'SPOT_TRADE',
  'SPOT_SESSION',
  'SPOT_SIGNATURE',
  'USDM_USER_DATA',
  'USDM_TRADE',
  'USDM_USER_STREAM',
  'MARGIN_USER_DATA_UNKNOWN',
  'MARGIN_TRADE_UNKNOWN',
  'MARGIN_USER_STREAM',
  'WALLET_USER_DATA_UNKNOWN',
  'MARKET_DATA_API_KEY',
  'LISTEN_KEY_STREAM',
  'LISTEN_TOKEN_UNKNOWN',
  'UNKNOWN',
] as const;
export const BINANCE_CONNECTION_POLICIES = [
  'NONE',
  'SPOT_WS_API',
  'SPOT_PUBLIC_WS',
  'USDM_WS',
  'USDM_WS_API',
  'USDM_PRIVATE_WS',
  'USDM_LISTEN_KEY',
  'MARGIN_RISK_WS',
  'MARGIN_RISK_KEY',
  'UNKNOWN',
] as const;

export type BinanceProduct = typeof BINANCE_PRODUCTS[number];
export type BinanceEnvironment = typeof BINANCE_ENVIRONMENTS[number];
export type BinanceRealm = typeof BINANCE_REALMS[number];
export type BinanceTransport = typeof BINANCE_TRANSPORTS[number];
export type BinanceLifecycle = typeof BINANCE_LIFECYCLES[number];
export type BinanceOperationKind = typeof BINANCE_OPERATION_KINDS[number];
export type BinanceHttpMethod = typeof BINANCE_HTTP_METHODS[number];
export type BinanceSecurityType = typeof BINANCE_SECURITY_TYPES[number];
export type BinanceKeyType = typeof BINANCE_KEY_TYPES[number];
export type BinanceSigningAlgorithm = typeof BINANCE_SIGNING_ALGORITHMS[number];
export type BinanceCanonicalEncoding = typeof BINANCE_ENCODINGS[number];
export type BinanceTimestampUnit = typeof BINANCE_TIMESTAMP_UNITS[number];
export type BinanceRateState = typeof BINANCE_RATE_STATES[number];
export type BinanceRateKind = typeof BINANCE_RATE_KINDS[number];
export type BinanceRateScope = typeof BINANCE_RATE_SCOPES[number];
export type BinanceRateInterval = typeof BINANCE_RATE_INTERVALS[number];
export type BinanceRateCondition = typeof BINANCE_RATE_CONDITIONS[number];
export type BinanceDataSource = typeof BINANCE_DATA_SOURCES[number];
export type BinanceMutationClass = typeof BINANCE_MUTATION_CLASSES[number];
export type BinanceAmbiguityClass = typeof BINANCE_AMBIGUITY_CLASSES[number];
export type BinanceSafeRetryClass = typeof BINANCE_SAFE_RETRY_CLASSES[number];
export type BinanceResponseSchemaState = typeof BINANCE_RESPONSE_SCHEMA_STATES[number];
export type BinanceActionAuthority = typeof BINANCE_ACTION_AUTHORITIES[number];
export type BinanceDocumentaryAuthority = typeof BINANCE_DOCUMENTARY_AUTHORITIES[number];
export type BinanceExternalActionAuthorization = typeof BINANCE_EXTERNAL_ACTION_AUTHORIZATIONS[number];
export type BinanceDigestScope = typeof BINANCE_DIGEST_SCOPES[number];
export type BinanceSourceContentDigestScope = typeof BINANCE_SOURCE_CONTENT_DIGEST_SCOPES[number];
export type BinanceAuthenticationPolicy = typeof BINANCE_AUTHENTICATION_POLICIES[number];
export type BinanceConnectionPolicy = typeof BINANCE_CONNECTION_POLICIES[number];

export interface BinanceOfficialSourceRecord {
  readonly id: string;
  readonly productScopes: readonly BinanceProduct[];
  readonly pageTitle: string;
  readonly officialUrl: string;
  readonly checkedAt: string;
  readonly lastModified: string | null;
  readonly revisionSignal: string;
  readonly digestScope: BinanceDigestScope;
  readonly evidence: readonly string[];
  readonly evidenceSha256: string;
  readonly sourceContentDigestScope: BinanceSourceContentDigestScope;
  readonly sourceContentUrl: string | null;
  readonly sourceContentSha256: string | null;
}

export interface BinanceOperation {
  readonly kind: BinanceOperationKind;
  readonly httpMethod: BinanceHttpMethod | null;
  readonly value: string;
  readonly queryTemplate: string | null;
}

export interface BinanceAuthenticationRules {
  readonly securityType: BinanceSecurityType;
  readonly permittedKeyTypes: readonly BinanceKeyType[];
  readonly signingAlgorithm: BinanceSigningAlgorithm;
  readonly canonicalEncoding: BinanceCanonicalEncoding;
  readonly timestampUnit: BinanceTimestampUnit;
  readonly recvWindowDefaultMs: number | null;
  readonly recvWindowMaxMs: number | null;
  readonly requiredParameters: readonly string[];
}

export interface BinanceRateLimitClaim {
  readonly sourceId: string;
  readonly kind: BinanceRateKind;
  readonly scope: BinanceRateScope;
  readonly value: number;
  readonly interval: BinanceRateInterval;
  readonly header: string | null;
  readonly condition: BinanceRateCondition;
}

export interface BinanceRateLimitFacts {
  readonly state: BinanceRateState;
  readonly claims: readonly BinanceRateLimitClaim[];
}

export interface BinanceConnectionFacts {
  readonly connectionLifetimeMinutes: number | null;
  readonly tokenLifetimeMinutes: number | null;
  readonly renewalRule: string;
  readonly pingIntervalSeconds: number | null;
  readonly pongTimeoutSeconds: number | null;
  readonly incomingMessagesPerSecond: number | null;
  readonly maximumStreams: number | null;
  readonly orderingRule: string;
}

export interface BinanceResponseSchemaFacts {
  readonly state: BinanceResponseSchemaState;
  readonly revision: string | null;
  readonly sha256: string | null;
}

export interface BinanceContractRecord {
  readonly id: string;
  readonly product: BinanceProduct;
  readonly environment: BinanceEnvironment;
  readonly realm: BinanceRealm;
  readonly transport: BinanceTransport;
  readonly lifecycle: BinanceLifecycle;
  /** Null only for an explicit conflict, unknown gap, or proved non-applicable capability. */
  readonly baseUrl: string | null;
  readonly operation: BinanceOperation | null;
  readonly authentication: BinanceAuthenticationRules;
  readonly rateLimit: BinanceRateLimitFacts;
  readonly connection: BinanceConnectionFacts;
  readonly dataSource: BinanceDataSource;
  readonly mutationClass: BinanceMutationClass;
  readonly ambiguityClass: BinanceAmbiguityClass;
  readonly safeRetryClass: BinanceSafeRetryClass;
  readonly responseSchema: BinanceResponseSchemaFacts;
  readonly sourceIds: readonly string[];
  readonly documentaryAuthority: BinanceDocumentaryAuthority;
  readonly externalActionAuthorization: BinanceExternalActionAuthorization;
  readonly actionAuthority: BinanceActionAuthority;
  readonly notes: string;
}

/** Compact inert authoring shape expanded into full documentary contracts. */
export interface BinanceContractSeed {
  readonly id: string;
  readonly product: BinanceProduct;
  readonly environment: BinanceEnvironment;
  readonly realm: BinanceRealm;
  readonly transport: BinanceTransport;
  readonly lifecycle: BinanceLifecycle;
  readonly baseUrl: string | null;
  readonly operation: BinanceOperation | null;
  readonly authenticationPolicy: BinanceAuthenticationPolicy;
  readonly requiredParameters: readonly string[];
  readonly rateLimit: BinanceRateLimitFacts;
  readonly connectionPolicy: BinanceConnectionPolicy;
  readonly dataSource: BinanceDataSource;
  readonly mutationClass: BinanceMutationClass;
  readonly ambiguityClass: BinanceAmbiguityClass;
  readonly safeRetryClass: BinanceSafeRetryClass;
  readonly responseSchema?: BinanceResponseSchemaFacts;
  readonly sourceIds: readonly string[];
  readonly notes: string;
}

export interface BinanceContractMatrix {
  readonly schema: typeof BINANCE_CONTRACT_MATRIX_SCHEMA;
  readonly revision: typeof BINANCE_CONTRACT_MATRIX_REVISION;
  readonly checkedAt: typeof BINANCE_CONTRACT_MATRIX_CHECKED_AT;
  readonly documentaryAuthority: BinanceDocumentaryAuthority;
  readonly externalActionAuthorization: BinanceExternalActionAuthorization;
  readonly selectedPrivateContractIds: Readonly<Record<BinanceProduct, string | null>>;
  readonly selectedSpotUserDataEncoding: 'JSON_TEXT';
  readonly selectedSpotSignatureKeyType: 'HMAC';
  readonly spotUserDataLifecycle: Readonly<{
    oneActiveSubscriptionPerAccountPerConnection: 1;
    maximumSimultaneousSubscriptions: 1000;
    maximumLifetimeSubscriptions: 65535;
    connectionLifetimeMinutes: 1440;
    unsubscribeMethod: 'userDataStream.unsubscribe';
    omissionOfSubscriptionIdClosesAll: true;
    terminationEvent: 'eventStreamTerminated';
    abruptDisconnectTerminationEvent: 'UNKNOWN';
  }>;
  readonly rateHeaderTemplates: readonly string[];
  readonly protectedLocators: Readonly<Record<string, Readonly<{
    product: BinanceProduct;
    environment: BinanceEnvironment;
    transport: BinanceTransport;
    baseUrl: string | null;
    operation: BinanceOperation;
  }>>>;
  readonly marginAccountModeFacts: Readonly<{
    selectorParameter: 'isIsolated';
    falseOrOmittedMode: 'CROSS_MARGIN';
    trueMode: 'ISOLATED_MARGIN_PAIR';
    isolatedModeRequiresSymbol: true;
    portfolioMarginSupported: false;
  }>;
  readonly apiKeyProfilePolicy: Readonly<{
    defaultProfiles: readonly ['READ_KEY', 'EXECUTION_KEY'];
    combinedKeyPosture: 'OWNER_EXCEPTION_REQUIRED';
    withdrawalsForLiveEntry: 'MUST_BE_DISABLED';
    transfersForLiveEntry: 'MUST_BE_DISABLED_WHERE_EXPOSED';
    fixedIpRestriction: 'REQUIRED';
    fixedIpDeployedEgressMatch: 'REQUIRED';
    onlyRequiredProductPermissions: 'REQUIRED';
    accountFingerprintRealmMatch: 'REQUIRED';
    supportedOwnerApprovedModes: 'REQUIRED';
    requiredAccountStatusValue: 'Normal';
    apiTradingLockedRequired: false;
    requiredUsdmMultiAssetsMarginValue: false;
    requiredUsdmDualSidePositionValue: false;
    unprovedBlocksLiveEntry: true;
  }>;
  readonly apiKeyPermissionFields: readonly [
    'ipRestrict', 'enableReading', 'enableWithdrawals', 'enableInternalTransfer',
    'enableMargin', 'enableFutures', 'permitsUniversalTransfer', 'enableVanillaOptions',
    'enableFixApiTrade', 'enableFixReadOnly', 'enableSpotAndMarginTrading',
    'enablePortfolioMarginTrading',
  ];
  readonly unsupportedAccountModes: readonly ['PORTFOLIO_MARGIN', 'MULTI_ASSETS', 'HEDGE_MODE'];
  readonly sources: readonly BinanceOfficialSourceRecord[];
  readonly contracts: readonly BinanceContractRecord[];
  readonly approvedProductBases: Readonly<Record<string, readonly string[]>>;
  readonly obsoleteRouteFacts: Readonly<{
    spotRestUserDataPath: string;
    spotRetiredWsMethods: readonly string[];
    spotPublicStreamPrefixes: readonly string[];
    marginRetiredRestPaths: readonly string[];
    usdmUnroutedWebSocketBase: string;
  }>;
  /** SHA-256 of the canonical matrix payload excluding this field. */
  readonly contentSha256: string;
}

export interface BinanceRouteFixture {
  readonly id: string;
  readonly product: BinanceProduct;
  readonly environment: BinanceEnvironment;
  readonly realm: BinanceRealm;
  readonly transport: BinanceTransport;
  readonly baseUrl: string;
  readonly operation: BinanceOperation;
}

export interface BinanceContractIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type BinanceMatrixValidationResult =
  | Readonly<{ ok: true; matrix: BinanceContractMatrix }>
  | Readonly<{ ok: false; issues: readonly Readonly<BinanceContractIssue>[] }>;

export type BinanceRouteFixtureResult =
  | Readonly<{
      ok: true;
      contractId: string;
      lifecycle: 'CURRENT';
      actionAuthority: 'NONE_RECORD_ONLY';
    }>
  | Readonly<{
      ok: false;
      code: string;
      reason: string;
      contractId: string | null;
    }>;
