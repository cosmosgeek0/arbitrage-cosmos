import {
  BINANCE_APPROVED_PRODUCT_BASES,
  BINANCE_ADDITIONAL_CONTRACT_SEEDS,
  BINANCE_DOCUMENTED_CONTRACTS,
  BINANCE_OBSOLETE_ROUTE_FACTS,
  BINANCE_OFFICIAL_SOURCES,
  BINANCE_PROTECTED_LOCATORS,
  BINANCE_RATE_HEADER_TEMPLATES,
} from './manifest.js';
import {
  BINANCE_CONTRACT_MATRIX_CHECKED_AT,
  BINANCE_CONTRACT_MATRIX_REVISION,
  BINANCE_CONTRACT_MATRIX_SCHEMA,
  type BinanceAuthenticationRules,
  type BinanceConnectionFacts,
  type BinanceContractRecord,
  type BinanceContractSeed,
  type BinanceContractMatrix,
} from './types.js';

function authenticationFor(seed: BinanceContractSeed): BinanceAuthenticationRules {
  const requiredParameters = [...seed.requiredParameters];
  switch (seed.authenticationPolicy) {
    case 'PUBLIC_NONE':
      return { securityType: 'NONE', permittedKeyTypes: [], signingAlgorithm: 'NONE', canonicalEncoding: 'NOT_APPLICABLE', timestampUnit: 'NOT_APPLICABLE', recvWindowDefaultMs: null, recvWindowMaxMs: null, requiredParameters };
    case 'MIXED_SPOT':
      return { securityType: 'MIXED_BY_ENDPOINT', permittedKeyTypes: ['HMAC', 'RSA', 'ED25519'], signingAlgorithm: 'HMAC_RSA_ED25519', canonicalEncoding: 'PERCENT_ENCODE_BEFORE_SIGNING', timestampUnit: 'MILLISECONDS_OR_MICROSECONDS', recvWindowDefaultMs: 5000, recvWindowMaxMs: 60000, requiredParameters };
    case 'SPOT_USER_DATA':
      return { securityType: 'USER_DATA', permittedKeyTypes: ['HMAC', 'RSA', 'ED25519'], signingAlgorithm: 'HMAC_RSA_ED25519', canonicalEncoding: 'PERCENT_ENCODE_BEFORE_SIGNING', timestampUnit: 'MILLISECONDS_OR_MICROSECONDS', recvWindowDefaultMs: 5000, recvWindowMaxMs: 60000, requiredParameters };
    case 'SPOT_TRADE':
      return { securityType: 'TRADE', permittedKeyTypes: ['HMAC', 'RSA', 'ED25519'], signingAlgorithm: 'HMAC_RSA_ED25519', canonicalEncoding: 'PERCENT_ENCODE_BEFORE_SIGNING', timestampUnit: 'MILLISECONDS_OR_MICROSECONDS', recvWindowDefaultMs: 5000, recvWindowMaxMs: 60000, requiredParameters };
    case 'SPOT_SESSION':
      return { securityType: 'SESSION_AUTHENTICATED', permittedKeyTypes: ['ED25519'], signingAlgorithm: 'NONE', canonicalEncoding: 'NOT_APPLICABLE', timestampUnit: 'NOT_APPLICABLE', recvWindowDefaultMs: null, recvWindowMaxMs: null, requiredParameters };
    case 'SPOT_SIGNATURE':
      return { securityType: 'API_KEY_SIGNATURE', permittedKeyTypes: ['HMAC', 'RSA', 'ED25519'], signingAlgorithm: 'HMAC_RSA_ED25519', canonicalEncoding: 'WS_SORTED_PARAMS', timestampUnit: 'MILLISECONDS_OR_MICROSECONDS', recvWindowDefaultMs: 5000, recvWindowMaxMs: 60000, requiredParameters };
    case 'USDM_USER_DATA':
      return { securityType: 'USER_DATA', permittedKeyTypes: ['HMAC'], signingAlgorithm: 'HMAC_SHA256', canonicalEncoding: 'TOTAL_PARAMS_QUERY_THEN_BODY', timestampUnit: 'MILLISECONDS', recvWindowDefaultMs: 5000, recvWindowMaxMs: null, requiredParameters };
    case 'USDM_TRADE':
      return { securityType: 'TRADE', permittedKeyTypes: ['HMAC'], signingAlgorithm: 'HMAC_SHA256', canonicalEncoding: 'TOTAL_PARAMS_QUERY_THEN_BODY', timestampUnit: 'MILLISECONDS', recvWindowDefaultMs: 5000, recvWindowMaxMs: null, requiredParameters };
    case 'USDM_USER_STREAM':
      return { securityType: 'USER_STREAM', permittedKeyTypes: [], signingAlgorithm: 'NONE', canonicalEncoding: 'NOT_APPLICABLE', timestampUnit: 'NOT_APPLICABLE', recvWindowDefaultMs: null, recvWindowMaxMs: null, requiredParameters };
    case 'MARGIN_USER_DATA_UNKNOWN':
      return { securityType: 'USER_DATA', permittedKeyTypes: [], signingAlgorithm: 'UNKNOWN', canonicalEncoding: 'PERCENT_ENCODE_BEFORE_SIGNING', timestampUnit: 'MILLISECONDS', recvWindowDefaultMs: null, recvWindowMaxMs: 60000, requiredParameters };
    case 'MARGIN_TRADE_UNKNOWN':
      return { securityType: 'TRADE', permittedKeyTypes: [], signingAlgorithm: 'UNKNOWN', canonicalEncoding: 'PERCENT_ENCODE_BEFORE_SIGNING', timestampUnit: 'MILLISECONDS', recvWindowDefaultMs: null, recvWindowMaxMs: 60000, requiredParameters };
    case 'MARGIN_USER_STREAM':
      return { securityType: 'USER_STREAM', permittedKeyTypes: [], signingAlgorithm: 'NONE', canonicalEncoding: 'NOT_APPLICABLE', timestampUnit: 'NOT_APPLICABLE', recvWindowDefaultMs: null, recvWindowMaxMs: null, requiredParameters };
    case 'WALLET_USER_DATA_UNKNOWN':
      return { securityType: 'USER_DATA', permittedKeyTypes: [], signingAlgorithm: 'UNKNOWN', canonicalEncoding: 'UNKNOWN', timestampUnit: 'MILLISECONDS', recvWindowDefaultMs: null, recvWindowMaxMs: 60000, requiredParameters };
    case 'MARKET_DATA_API_KEY':
      return { securityType: 'MARKET_DATA', permittedKeyTypes: ['ED25519'], signingAlgorithm: 'NONE', canonicalEncoding: 'NOT_APPLICABLE', timestampUnit: 'NOT_APPLICABLE', recvWindowDefaultMs: null, recvWindowMaxMs: null, requiredParameters };
    case 'LISTEN_KEY_STREAM':
      return { securityType: 'LISTEN_KEY', permittedKeyTypes: [], signingAlgorithm: 'NONE', canonicalEncoding: 'NOT_APPLICABLE', timestampUnit: 'NOT_APPLICABLE', recvWindowDefaultMs: null, recvWindowMaxMs: null, requiredParameters };
    case 'LISTEN_TOKEN_UNKNOWN':
      return { securityType: 'LISTEN_TOKEN', permittedKeyTypes: [], signingAlgorithm: 'UNKNOWN', canonicalEncoding: 'UNKNOWN', timestampUnit: 'UNKNOWN', recvWindowDefaultMs: null, recvWindowMaxMs: null, requiredParameters };
    case 'UNKNOWN':
      return { securityType: 'UNKNOWN', permittedKeyTypes: [], signingAlgorithm: 'UNKNOWN', canonicalEncoding: 'UNKNOWN', timestampUnit: 'UNKNOWN', recvWindowDefaultMs: null, recvWindowMaxMs: null, requiredParameters };
  }
}

function connectionFor(policy: BinanceContractSeed['connectionPolicy']): BinanceConnectionFacts {
  switch (policy) {
    case 'SPOT_WS_API':
      return { connectionLifetimeMinutes: 1440, tokenLifetimeMinutes: null, renewalRule: 'RECONNECT_BEFORE_24_HOURS', pingIntervalSeconds: 20, pongTimeoutSeconds: 60, incomingMessagesPerSecond: null, maximumStreams: 1000, orderingRule: 'ONE_ACTIVE_SUBSCRIPTION_PER_ACCOUNT_PER_CONNECTION' };
    case 'SPOT_PUBLIC_WS':
      return { connectionLifetimeMinutes: 1440, tokenLifetimeMinutes: null, renewalRule: 'RECONNECT_BEFORE_24_HOURS', pingIntervalSeconds: 20, pongTimeoutSeconds: 60, incomingMessagesPerSecond: 5, maximumStreams: 1024, orderingRule: 'STREAM_SPECIFIC' };
    case 'USDM_WS':
      return { connectionLifetimeMinutes: 1440, tokenLifetimeMinutes: null, renewalRule: 'RECONNECT_BEFORE_24_HOURS', pingIntervalSeconds: 180, pongTimeoutSeconds: 600, incomingMessagesPerSecond: 10, maximumStreams: 1024, orderingRule: 'STREAM_SPECIFIC' };
    case 'USDM_WS_API':
      return { connectionLifetimeMinutes: 1440, tokenLifetimeMinutes: null, renewalRule: 'RECONNECT_BEFORE_24_HOURS', pingIntervalSeconds: null, pongTimeoutSeconds: null, incomingMessagesPerSecond: null, maximumStreams: null, orderingRule: 'REQUEST_ID_CORRELATION' };
    case 'USDM_PRIVATE_WS':
      return { connectionLifetimeMinutes: 1440, tokenLifetimeMinutes: 60, renewalRule: 'PUT_EXTENDS_60_MINUTES', pingIntervalSeconds: null, pongTimeoutSeconds: null, incomingMessagesPerSecond: null, maximumStreams: null, orderingRule: 'SAME_EVENT_TYPE_STRICT_BY_TRANSACTION_AND_EVENT_TIME' };
    case 'USDM_LISTEN_KEY':
      return { connectionLifetimeMinutes: null, tokenLifetimeMinutes: 60, renewalRule: 'POST_OR_PUT_EXTENDS_60_MINUTES', pingIntervalSeconds: null, pongTimeoutSeconds: null, incomingMessagesPerSecond: null, maximumStreams: null, orderingRule: 'NOT_APPLICABLE' };
    case 'MARGIN_RISK_WS':
      return { connectionLifetimeMinutes: 1440, tokenLifetimeMinutes: 60, renewalRule: 'PUT_EXTENDS_60_MINUTES', pingIntervalSeconds: null, pongTimeoutSeconds: null, incomingMessagesPerSecond: null, maximumStreams: null, orderingRule: 'RISK_EVENT_STREAM_ONLY' };
    case 'MARGIN_RISK_KEY':
      return { connectionLifetimeMinutes: null, tokenLifetimeMinutes: 60, renewalRule: 'POST_OR_PUT_EXTENDS_60_MINUTES', pingIntervalSeconds: null, pongTimeoutSeconds: null, incomingMessagesPerSecond: null, maximumStreams: null, orderingRule: 'NOT_APPLICABLE' };
    case 'UNKNOWN':
      return { connectionLifetimeMinutes: null, tokenLifetimeMinutes: null, renewalRule: 'UNKNOWN', pingIntervalSeconds: null, pongTimeoutSeconds: null, incomingMessagesPerSecond: null, maximumStreams: null, orderingRule: 'UNKNOWN' };
    case 'NONE':
      return { connectionLifetimeMinutes: null, tokenLifetimeMinutes: null, renewalRule: 'NOT_APPLICABLE', pingIntervalSeconds: null, pongTimeoutSeconds: null, incomingMessagesPerSecond: null, maximumStreams: null, orderingRule: 'NOT_APPLICABLE' };
  }
}

function expandSeed(seed: BinanceContractSeed): BinanceContractRecord {
  return {
    id: seed.id,
    product: seed.product,
    environment: seed.environment,
    realm: seed.realm,
    transport: seed.transport,
    lifecycle: seed.lifecycle,
    baseUrl: seed.baseUrl,
    operation: seed.operation,
    authentication: authenticationFor(seed),
    rateLimit: seed.rateLimit,
    connection: connectionFor(seed.connectionPolicy),
    dataSource: seed.dataSource,
    mutationClass: seed.mutationClass,
    ambiguityClass: seed.ambiguityClass,
    safeRetryClass: seed.safeRetryClass,
    responseSchema: seed.responseSchema ?? { state: 'UNKNOWN', revision: null, sha256: null },
    sourceIds: seed.sourceIds,
    documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
    externalActionAuthorization: 'NONE',
    actionAuthority: 'NONE_RECORD_ONLY',
    notes: seed.notes,
  };
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export const BINANCE_CONTRACT_MATRIX_CONTENT_SHA256 =
  '7302b7f5f90bb8f08791d07a2718adb1ca77a54d7e01f5a76079380c96cddbac' as const;

export const BINANCE_CONTRACT_MATRIX: BinanceContractMatrix = deepFreeze({
  schema: BINANCE_CONTRACT_MATRIX_SCHEMA,
  revision: BINANCE_CONTRACT_MATRIX_REVISION,
  checkedAt: BINANCE_CONTRACT_MATRIX_CHECKED_AT,
  documentaryAuthority: 'DOCUMENTARY_EVIDENCE_ONLY',
  externalActionAuthorization: 'NONE',
  selectedPrivateContractIds: {
    SPOT: 'SPOT_WS_API_USER_DATA_SIGNATURE',
    USD_M_PERPETUAL: 'USDM_WS_PRIVATE_USER_DATA',
    MARGIN: null,
  },
  selectedSpotUserDataEncoding: 'JSON_TEXT',
  selectedSpotSignatureKeyType: 'HMAC',
  spotUserDataLifecycle: {
    oneActiveSubscriptionPerAccountPerConnection: 1,
    maximumSimultaneousSubscriptions: 1000,
    maximumLifetimeSubscriptions: 65535,
    connectionLifetimeMinutes: 1440,
    unsubscribeMethod: 'userDataStream.unsubscribe',
    omissionOfSubscriptionIdClosesAll: true,
    terminationEvent: 'eventStreamTerminated',
    abruptDisconnectTerminationEvent: 'UNKNOWN',
  },
  rateHeaderTemplates: BINANCE_RATE_HEADER_TEMPLATES,
  protectedLocators: BINANCE_PROTECTED_LOCATORS,
  marginAccountModeFacts: {
    selectorParameter: 'isIsolated',
    falseOrOmittedMode: 'CROSS_MARGIN',
    trueMode: 'ISOLATED_MARGIN_PAIR',
    isolatedModeRequiresSymbol: true,
    portfolioMarginSupported: false,
  },
  apiKeyProfilePolicy: {
    defaultProfiles: ['READ_KEY', 'EXECUTION_KEY'],
    combinedKeyPosture: 'OWNER_EXCEPTION_REQUIRED',
    withdrawalsForLiveEntry: 'MUST_BE_DISABLED',
    transfersForLiveEntry: 'MUST_BE_DISABLED_WHERE_EXPOSED',
    fixedIpRestriction: 'REQUIRED',
    fixedIpDeployedEgressMatch: 'REQUIRED',
    onlyRequiredProductPermissions: 'REQUIRED',
    accountFingerprintRealmMatch: 'REQUIRED',
    supportedOwnerApprovedModes: 'REQUIRED',
    requiredAccountStatusValue: 'Normal',
    apiTradingLockedRequired: false,
    requiredUsdmMultiAssetsMarginValue: false,
    requiredUsdmDualSidePositionValue: false,
    unprovedBlocksLiveEntry: true,
  },
  apiKeyPermissionFields: [
    'ipRestrict', 'enableReading', 'enableWithdrawals', 'enableInternalTransfer',
    'enableMargin', 'enableFutures', 'permitsUniversalTransfer', 'enableVanillaOptions',
    'enableFixApiTrade', 'enableFixReadOnly', 'enableSpotAndMarginTrading',
    'enablePortfolioMarginTrading',
  ],
  unsupportedAccountModes: ['PORTFOLIO_MARGIN', 'MULTI_ASSETS', 'HEDGE_MODE'],
  sources: BINANCE_OFFICIAL_SOURCES,
  contracts: [
    ...BINANCE_DOCUMENTED_CONTRACTS,
    ...BINANCE_ADDITIONAL_CONTRACT_SEEDS.map(expandSeed),
  ],
  approvedProductBases: BINANCE_APPROVED_PRODUCT_BASES,
  obsoleteRouteFacts: BINANCE_OBSOLETE_ROUTE_FACTS,
  contentSha256: BINANCE_CONTRACT_MATRIX_CONTENT_SHA256,
});
