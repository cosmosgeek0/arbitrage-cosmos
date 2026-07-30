/**
 * Truthful backend projection for owner-gate-2 M0 readiness.
 *
 * Source existence and runtime proof are separate. The default projection is
 * deliberately NOT_READY and performs no refresh, private call, signature,
 * Ledger write, or transport action.
 */
import { createHash } from 'node:crypto';

import { canonicalJson } from '../../foundation/contracts/identity.js';
import type { BinanceSpotVenueEvidence } from '../../foundation/exchange/binanceSpot/filters.js';
import type {
  SpotCurrentM0Readiness,
  SpotFilterSnapshot,
  SpotOwnerSendAuthority,
  SpotRiskEvidence,
  SpotSignedTestEvidence,
} from '../../foundation/execution/spotCore.js';
import type { SpotExecutionTicket } from '../../foundation/execution/spotTicket.js';
import {
  OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
} from '../../foundation/risk/spotRiskPolicy.js';
import {
  M0_SPOT_ACTION_ALLOWLIST,
  M0_SPOT_MAXIMUM_FLATTEN_CANCEL_SUBMISSIONS,
  M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS,
} from '../../foundation/execution/m0SpotLifecycleCard.js';

export const M0_SPOT_READINESS_CARD_SCHEMA =
  'cosmos.system-integration.m0-spot-readiness-card.v1' as const;
export const M0_SPOT_EXECUTABLE_ENTRY_EVIDENCE_SCHEMA =
  'cosmos.system-integration.m0-spot-executable-entry-evidence.v1' as const;
export const M0_SPOT_READINESS_MAX_FRESHNESS_MS = 5_000 as const;
export const M0_SPOT_MAX_RESIDUAL_DUST_NOTIONAL_QUOTE =
  '0.01' as const;
export const M0_SPOT_PERMISSION_TRANSITIONS = Object.freeze({
  ACCOUNT_ONLY:
    'RESTORE_ACCOUNT_SPOT_TRADING_ELIGIBILITY_ONLY',
  EXECUTION_PROFILE_ONLY:
    'ENABLE_SPOT_AND_MARGIN_TRADING_ON_NAMED_EXECUTION_PROFILE_ONLY',
  ACCOUNT_AND_EXECUTION_PROFILE:
    'RESTORE_ACCOUNT_SPOT_TRADING_ELIGIBILITY_AND_ENABLE_SPOT_AND_MARGIN_TRADING_ON_NAMED_EXECUTION_PROFILE_ONLY',
} as const);
export const M0_SPOT_SOURCE_LIMITATION =
  'SOURCE_READY_NOT_RUNTIME_VERIFIED: the candidate implements the bounded Binance Spot M0 lifecycle behind default-disarmed, one-card/one-lifecycle authority, but no executor/host/boot composition, credential or independent account/key permission readback, private account call, signed test-order provider acceptance, current order/filter/fee/baseline/tolerance/recovery observation, live order, fill, cancel, flatten, Ledger append, venue reconciliation, rollback readback, deployment, or runtime acceptance occurred in this source-only milestone. Every observed permission fact is UNKNOWN, Gate 2 remains NOT_READY, and OWNER ACTION is NO until the sole lander plus gates 1/2 populate and verify every runtime-only row.' as const;

export type M0SpotProofState =
  | 'VERIFIED_CURRENT'
  | 'SOURCE_IMPLEMENTED_NOT_RUNTIME_VERIFIED'
  | 'UNKNOWN_NOT_VERIFIED'
  | 'NOT_APPLICABLE';

/**
 * Detached documentary projection of the single-use owner authority.
 *
 * Every non-secret identity, binding, ceiling and time field is covered by
 * the digest, but this data-only projection carries no verifier, signer,
 * credential, callback or consumable authority capability.
 */
export type M0SpotDocumentaryOwnerAuthorityEvidence = Readonly<
  Pick<
    SpotOwnerSendAuthority,
    | 'schema'
    | 'authorizationId'
    | 'verification'
    | 'ticketId'
    | 'termsDigest'
    | 'clientOrderId'
    | 'maxOrderNotionalQuote'
    | 'confirmedAtMs'
    | 'expiresAtMs'
    | 'singleUse'
  >
>;

/**
 * Canonical, data-only input for binding Gate 2 to the exact server-held
 * executable entry leg. `documentaryNowMs` normalizes the coordinator's
 * optional documentary timestamp to an explicit number or null.
 *
 * Deliberately excluded: API secrets, raw signing material, signer objects,
 * verifier callbacks, action-owner resolvers and reusable authority
 * capabilities. Their documentary identities belong on the readiness card;
 * the exact executable entry evidence below is recomputed by the executor.
 */
export interface M0SpotExecutableEntryEvidenceDigestInput {
  readonly schema: typeof M0_SPOT_EXECUTABLE_ENTRY_EVIDENCE_SCHEMA;
  readonly version: 1;
  readonly ticket: Readonly<SpotExecutionTicket>;
  readonly filterSnapshot: Readonly<SpotFilterSnapshot>;
  readonly documentaryNowMs: number | null;
  readonly riskEvidence: Readonly<SpotRiskEvidence> | null;
  readonly venueEvidence: Readonly<BinanceSpotVenueEvidence> | null;
  readonly readiness: Readonly<SpotCurrentM0Readiness>;
  readonly signedTestEvidence: Readonly<SpotSignedTestEvidence> | null;
  readonly ownerAuthorityEvidence:
    M0SpotDocumentaryOwnerAuthorityEvidence | null;
}

export interface M0SpotReadinessCard {
  readonly schema: typeof M0_SPOT_READINESS_CARD_SCHEMA;
  readonly version: 1;
  readonly readinessDigest: `sha256:${string}`;
  /** Digest of the exact executable lifecycle card; null until runtime proof. */
  readonly lifecycleCardDigest: `sha256:${string}` | null;
  /**
   * Digest of the complete data-only server-held entry leg evidence. The
   * executor recomputes it from the canonical bundle immediately before arm.
   */
  readonly executableEntryEvidenceDigest: `sha256:${string}` | null;
  readonly disposition:
    | 'SOURCE_READY_NOT_RUNTIME_VERIFIED'
    | 'M0_BLOCKED_PERMISSION'
    | 'READY_FOR_OWNER_GATE_2';
  readonly gate2Ready: boolean;
  readonly evidenceAuthority: 'SOURCE_ONLY' | 'RUNTIME_PRIVATE';
  readonly ownerId: string | null;
  readonly observedAtMs: number;
  readonly observedTimestampIst: string;
  /** Owner acknowledgement is stale after this instant; null is never ready. */
  readonly validUntilMs: number | null;
  readonly revisionHost: Readonly<{
    state: M0SpotProofState;
    revision: string | null;
    hostId: string | null;
    bootId: string | null;
    processId: string | null;
  }>;
  readonly accountMode: Readonly<{
    state: M0SpotProofState;
    accountId: string | null;
    accountType: 'SPOT' | null;
    privateReadVerified: boolean;
    balancesRead: boolean;
    ordersRead: boolean;
    fillsRead: boolean;
    permissionRead: boolean;
  }>;
  /** Independent `/api/v3/account` observation. */
  readonly accountCanTrade: Readonly<{
    state: M0SpotProofState;
    profileId: string | null;
    accountRealmId: string | null;
    accountFingerprintRef: string | null;
    permissionRevision: string | null;
    value: boolean | null;
    observedAtMs: number | null;
    validUntilMs: number | null;
    evidenceRevision: string | null;
    minimumPermissionTransition: string | null;
  }>;
  /** Independent `/sapi/v1/account/apiRestrictions` observations. */
  readonly apiKeyPermissions: Readonly<{
    state: M0SpotProofState;
    accountRealmId: string | null;
    accountFingerprintRef: string | null;
    evidenceDigest: `sha256:${string}` | null;
    readProfile: Readonly<{
      profileId: string | null;
      permissionRevision: string | null;
      signerFingerprint: `sha256:${string}` | null;
      signerRevision: string | null;
      observedAtMs: number | null;
      validUntilMs: number | null;
    }>;
    executionProfile: Readonly<{
      profileId: string | null;
      permissionRevision: string | null;
      signerFingerprint: `sha256:${string}` | null;
      signerRevision: string | null;
      observedAtMs: number | null;
      validUntilMs: number | null;
    }>;
    readingEnabled: boolean | null;
    spotTradeEnabled: boolean | null;
    ipRestricted: boolean | null;
    withdrawalsEnabled: boolean | null;
    internalTransfersEnabled: boolean | null;
    universalTransfersEnabled: boolean | null;
    marginEnabled: boolean | null;
    futuresEnabled: boolean | null;
    vanillaOptionsEnabled: boolean | null;
    fixTradeEnabled: boolean | null;
    fixReadOnlyEnabled: boolean | null;
    portfolioMarginEnabled: boolean | null;
    observedAtMs: number | null;
    validUntilMs: number | null;
    evidenceRevision: string | null;
  }>;
  readonly appExecutionArmed: Readonly<{
    state: M0SpotProofState;
    current: boolean;
    proposed:
      | 'REMAIN_DISARMED'
      | 'ARM_EXACT_CARD_AFTER_OWNER_YES';
  }>;
  readonly venueRoutes: Readonly<{
    venue: 'BINANCE_SPOT';
    compositionState: M0SpotProofState;
    signedTest: Readonly<{
      method: 'POST';
      path: '/api/v3/order/test';
    }>;
    entry: Readonly<{ method: 'POST'; path: '/api/v3/order' }>;
    query: Readonly<{ method: 'GET'; path: '/api/v3/order' }>;
    cancel: Readonly<{ method: 'DELETE'; path: '/api/v3/order' }>;
    fills: Readonly<{ method: 'GET'; path: '/api/v3/myTrades' }>;
  }>;
  /** Capabilities deliberately absent from the M0 runtime graph. */
  readonly excludedCapabilities: Readonly<{
    state: M0SpotProofState;
    futuresRoute: Readonly<{
      access: 'INACCESSIBLE_TO_M0';
      route: null;
    }>;
    marginBorrow: Readonly<{
      access: 'INACCESSIBLE_TO_M0';
      route: null;
      borrowAuthority: 'NONE';
    }>;
    leverage: Readonly<{
      availability: 'UNAVAILABLE';
      value: null;
    }>;
  }>;
  readonly namedExecutor: Readonly<{
    state: M0SpotProofState;
    executorId: string | null;
    hostId: string | null;
    bootId: string | null;
    processId: string | null;
    authority: 'NONE' | 'EXACT_CARD_ONE_LIFECYCLE';
  }>;
  readonly order: Readonly<{
    state: M0SpotProofState;
    symbol: string | null;
    baseAsset: string | null;
    allowlist: readonly string[];
    side: 'BUY';
    orderType: 'LIMIT';
    timeInForce: 'FOK';
    quoteAsset: 'USDT';
    price: string | null;
    quoteAmount: string | null;
    baseQuantity: string | null;
  }>;
  readonly limits: Readonly<{
    maximumOrderNotionalQuote:
      typeof OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE;
    maximumSimultaneousExposureQuote: string | null;
    maximumGrossLifecycleTurnoverQuote: string | null;
    maximumLossQuote: string | null;
    maximumExposureDurationMs: number | null;
    maximumResidualDustNotionalQuote:
      typeof M0_SPOT_MAX_RESIDUAL_DUST_NOTIONAL_QUOTE;
    maximumSignedTestSubmissions: 1;
    maximumEntrySubmissions: 1;
    maximumEntryCancelSubmissions: 1;
    maximumFlattenSubmissions:
      typeof M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS;
    maximumFlattenCancelSubmissions:
      typeof M0_SPOT_MAXIMUM_FLATTEN_CANCEL_SUBMISSIONS;
    maximumLifecycles: 1;
  }>;
  readonly filters: Readonly<{
    state: M0SpotProofState;
    symbolStatus: 'TRADING' | null;
    baseAsset: string | null;
    quoteAsset: 'USDT' | null;
    spotTradingAllowed: boolean | null;
    minPrice: string | null;
    maxPrice: string | null;
    minNotional: string | null;
    maxNotional: string | null;
    tickSize: string | null;
    minQuantity: string | null;
    maxQuantity: string | null;
    stepSize: string | null;
    pricePrecision: number | null;
    quantityPrecision: number | null;
    activeFilterTypes: readonly string[] | null;
    unknownFilterTypes: readonly string[] | null;
    allActiveFiltersSatisfied: boolean | null;
    completeSnapshotDigest: `sha256:${string}` | null;
    observedAtMs: number | null;
    validUntilMs: number | null;
    snapshotRevision: string | null;
  }>;
  /** Current, bounded evidence for the card's one liquid symbol. */
  readonly liquidity: Readonly<{
    state: M0SpotProofState;
    symbol: string | null;
    classification: 'LIQUID' | null;
    observedSpreadBps: string | null;
    maximumSpreadBps: string | null;
    observedDepthQuote: string | null;
    minimumDepthQuote: string | null;
    evidenceDigest: `sha256:${string}` | null;
    observedAtMs: number | null;
    validUntilMs: number | null;
    evidenceRevision: string | null;
  }>;
  readonly economics: Readonly<{
    state: M0SpotProofState;
    makerRate: string | null;
    takerRate: string | null;
    feeChargingAsset: string | null;
    discountEnabled: boolean | null;
    expectedEntryFeeQuote: string | null;
    expectedRecoveryFeeQuote: string | null;
    totalFeeReserveQuote: string | null;
    maximumSlippageQuote: string | null;
    observedAtMs: number | null;
    validUntilMs: number | null;
    evidenceRevision: string | null;
  }>;
  readonly baseline: Readonly<{
    state: M0SpotProofState;
    baseAsset: string | null;
    quoteAsset: 'USDT' | null;
    baselineBaseQuantity: string | null;
    baselineQuoteQuantity: string | null;
    observedBaseDeltaQuantity: string | null;
    observedQuoteDeltaQuantity: string | null;
    exchangeBaseTolerance: string | null;
    quoteQuantityTolerance: string | null;
    openOrderCount: number | null;
    unresolvedMutationCount: number | null;
    matched: boolean | null;
    matchKind: 'EXACT' | 'WITHIN_EXPLICIT_TOLERANCE' | null;
    observedAtMs: number | null;
    validUntilMs: number | null;
    baselineRevision: string | null;
  }>;
  readonly clientIdentity: Readonly<{
    state: M0SpotProofState;
    ticketId: string | null;
    entryClientOrderId: string | null;
    termsDigest: string | null;
    queryKey: 'origClientOrderId';
  }>;
  readonly validation: Readonly<{
    state: M0SpotProofState;
    signedTestPassed: boolean | null;
    observedAtMs: number | null;
    validUntilMs: number | null;
    evidenceRevision: string | null;
  }>;
  readonly timing: Readonly<{
    requestTimeoutMs: 5000;
    recvWindowMs: 5000;
    queryBeforeRetry: true;
    blindResend: false;
  }>;
  readonly executorActionAllowlist: typeof M0_SPOT_ACTION_ALLOWLIST;
  readonly recovery: Readonly<{
    state: M0SpotProofState;
    law:
      'CANCEL_OPEN_REMAINDER_THEN_FLATTEN_EXACT_CANARY_ATTRIBUTABLE_EXPOSURE_UNTIL_BASELINE';
    baselineRevision: string | null;
    exchangeBaseTolerance: string | null;
    quoteQuantityTolerance: string | null;
    maximumResidualDustNotionalQuote:
      typeof M0_SPOT_MAX_RESIDUAL_DUST_NOTIONAL_QUOTE;
    feeReserveQuote: string | null;
    maximumRecoveryDurationMs: number | null;
    cancelExactOrderOnly: true;
    flattenExactResidualOnly: true;
    remainsAuthorizedAfterKill: true;
    remainsAuthorizedAcrossRestart: true;
  }>;
  readonly ledgerReconciliation: Readonly<{
    state: M0SpotProofState;
    appendOnlyLedger: 'COSMOS_LEDGER';
    requiredEvents: readonly [
      'INTENT',
      'REQUEST',
      'RESPONSE',
      'FILL',
      'CANCEL',
      'RECOVERY',
      'FINAL_STATE',
    ];
    venueEqualsLocal: boolean | null;
  }>;
  readonly lifecycle: Readonly<{
    state: M0SpotProofState;
    oneEntry: true;
    oneLifecycle: true;
    blindResend: false;
    recoveryAuthorizedUntilFlat: true;
    finalDisarmAfterVenueAndLocalFlat: true;
  }>;
  readonly rollback: Readonly<{
    state: M0SpotProofState;
    trigger: 'OWNER_ABORT_OR_PRE_ENTRY_GATE_FAILURE';
    targetState: 'DISARMED_KILL_ENGAGED';
    ownerId: string | null;
    procedure: string | null;
    configRevision: string | null;
    evidenceRevision: string | null;
    reversesMarketExposure: false;
  }>;
  readonly residualCondition:
    | 'SOURCE_READY_NOT_RUNTIME_VERIFIED'
    | 'EXACT_ZERO_DELTA_BASELINE_VERIFIED'
    | 'EXPLICIT_BOUNDED_DUST_BASELINE_VERIFIED';
  readonly exactLimitation: string | null;
  readonly ownerAction: 'YES' | 'NO';
  readonly effects: Readonly<{
    privateCalls: number;
    signatures: number;
    transportCalls: number;
    authorityConsumptions: number;
    ledgerWrites: number;
    orders: number;
    moneyMutations: number;
  }>;
}

const REQUIRED_LEDGER_EVENTS = Object.freeze([
  'INTENT',
  'REQUEST',
  'RESPONSE',
  'FILL',
  'CANCEL',
  'RECOVERY',
  'FINAL_STATE',
] as const);

export function calculateM0SpotReadinessDigest(
  value: Omit<M0SpotReadinessCard, 'readinessDigest'>,
): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(`m0-spot-readiness-card|${canonicalJson(value)}`, 'utf8')
    .digest('hex')}` as const;
}

export function calculateM0SpotExecutableEntryEvidenceDigest(
  value: Readonly<M0SpotExecutableEntryEvidenceDigestInput>,
): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(
      `m0-spot-executable-entry-evidence|${canonicalJson(value)}`,
      'utf8',
    )
    .digest('hex')}` as const;
}

export function exactM0SpotMinimumPermissionTransition(
  accountCanTrade: boolean,
  executionProfileSpotTradeEnabled: boolean,
): typeof M0_SPOT_PERMISSION_TRANSITIONS[keyof typeof M0_SPOT_PERMISSION_TRANSITIONS] | null {
  if (accountCanTrade && executionProfileSpotTradeEnabled) return null;
  if (!accountCanTrade && executionProfileSpotTradeEnabled) {
    return M0_SPOT_PERMISSION_TRANSITIONS.ACCOUNT_ONLY;
  }
  if (accountCanTrade) {
    return M0_SPOT_PERMISSION_TRANSITIONS.EXECUTION_PROFILE_ONLY;
  }
  return M0_SPOT_PERMISSION_TRANSITIONS.ACCOUNT_AND_EXECUTION_PROFILE;
}

function istTimestamp(value: number): string {
  return new Date(value + (5.5 * 60 * 60 * 1_000))
    .toISOString()
    .replace(/Z$/u, '+05:30');
}

/**
 * Project the exact source-only §7 input card. Calling this function reads
 * only the injected timestamp.
 */
export function projectM0SpotSourceReadinessCard(
  observedAtMs: number,
): Readonly<M0SpotReadinessCard> {
  if (
    !Number.isSafeInteger(observedAtMs)
    || observedAtMs < 0
    || observedAtMs > 8_639_999_980_200_000
  ) {
    throw new TypeError('M0 readiness observation time is invalid');
  }
  const withoutDigest = Object.freeze({
    schema: M0_SPOT_READINESS_CARD_SCHEMA,
    version: 1 as const,
    lifecycleCardDigest: null,
    executableEntryEvidenceDigest: null,
    disposition: 'SOURCE_READY_NOT_RUNTIME_VERIFIED' as const,
    gate2Ready: false,
    evidenceAuthority: 'SOURCE_ONLY' as const,
    ownerId: null,
    observedAtMs,
    observedTimestampIst: istTimestamp(observedAtMs),
    validUntilMs: null,
    revisionHost: Object.freeze({
      state: 'UNKNOWN_NOT_VERIFIED' as const,
      revision: null,
      hostId: null,
      bootId: null,
      processId: null,
    }),
    accountMode: Object.freeze({
      state: 'UNKNOWN_NOT_VERIFIED' as const,
      accountId: null,
      accountType: null,
      privateReadVerified: false,
      balancesRead: false,
      ordersRead: false,
      fillsRead: false,
      permissionRead: false,
    }),
    accountCanTrade: Object.freeze({
      state: 'UNKNOWN_NOT_VERIFIED' as const,
      profileId: null,
      accountRealmId: null,
      accountFingerprintRef: null,
      permissionRevision: null,
      value: null,
      observedAtMs: null,
      validUntilMs: null,
      evidenceRevision: null,
      minimumPermissionTransition: null,
    }),
    apiKeyPermissions: Object.freeze({
      state: 'UNKNOWN_NOT_VERIFIED' as const,
      accountRealmId: null,
      accountFingerprintRef: null,
      evidenceDigest: null,
      readProfile: Object.freeze({
        profileId: null,
        permissionRevision: null,
        signerFingerprint: null,
        signerRevision: null,
        observedAtMs: null,
        validUntilMs: null,
      }),
      executionProfile: Object.freeze({
        profileId: null,
        permissionRevision: null,
        signerFingerprint: null,
        signerRevision: null,
        observedAtMs: null,
        validUntilMs: null,
      }),
      readingEnabled: null,
      spotTradeEnabled: null,
      ipRestricted: null,
      withdrawalsEnabled: null,
      internalTransfersEnabled: null,
      universalTransfersEnabled: null,
      marginEnabled: null,
      futuresEnabled: null,
      vanillaOptionsEnabled: null,
      fixTradeEnabled: null,
      fixReadOnlyEnabled: null,
      portfolioMarginEnabled: null,
      observedAtMs: null,
      validUntilMs: null,
      evidenceRevision: null,
    }),
    appExecutionArmed: Object.freeze({
      state: 'VERIFIED_CURRENT' as const,
      current: false,
      proposed: 'REMAIN_DISARMED' as const,
    }),
    venueRoutes: Object.freeze({
      venue: 'BINANCE_SPOT' as const,
      compositionState:
        'SOURCE_IMPLEMENTED_NOT_RUNTIME_VERIFIED' as const,
      signedTest: Object.freeze({
        method: 'POST' as const,
        path: '/api/v3/order/test' as const,
      }),
      entry: Object.freeze({
        method: 'POST' as const,
        path: '/api/v3/order' as const,
      }),
      query: Object.freeze({
        method: 'GET' as const,
        path: '/api/v3/order' as const,
      }),
      cancel: Object.freeze({
        method: 'DELETE' as const,
        path: '/api/v3/order' as const,
      }),
      fills: Object.freeze({
        method: 'GET' as const,
        path: '/api/v3/myTrades' as const,
      }),
    }),
    excludedCapabilities: Object.freeze({
      state: 'SOURCE_IMPLEMENTED_NOT_RUNTIME_VERIFIED' as const,
      futuresRoute: Object.freeze({
        access: 'INACCESSIBLE_TO_M0' as const,
        route: null,
      }),
      marginBorrow: Object.freeze({
        access: 'INACCESSIBLE_TO_M0' as const,
        route: null,
        borrowAuthority: 'NONE' as const,
      }),
      leverage: Object.freeze({
        availability: 'UNAVAILABLE' as const,
        value: null,
      }),
    }),
    namedExecutor: Object.freeze({
      state: 'UNKNOWN_NOT_VERIFIED' as const,
      executorId: null,
      hostId: null,
      bootId: null,
      processId: null,
      authority: 'NONE' as const,
    }),
    order: Object.freeze({
      state: 'UNKNOWN_NOT_VERIFIED' as const,
      symbol: null,
      baseAsset: null,
      allowlist: Object.freeze([]) as readonly string[],
      side: 'BUY' as const,
      orderType: 'LIMIT' as const,
      timeInForce: 'FOK' as const,
      quoteAsset: 'USDT' as const,
      price: null,
      quoteAmount: null,
      baseQuantity: null,
    }),
    limits: Object.freeze({
      maximumOrderNotionalQuote:
        OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
      maximumSimultaneousExposureQuote: null,
      maximumGrossLifecycleTurnoverQuote: null,
      maximumLossQuote: null,
      maximumExposureDurationMs: null,
      maximumResidualDustNotionalQuote:
        M0_SPOT_MAX_RESIDUAL_DUST_NOTIONAL_QUOTE,
      maximumSignedTestSubmissions: 1 as const,
      maximumEntrySubmissions: 1 as const,
      maximumEntryCancelSubmissions: 1 as const,
      maximumFlattenSubmissions:
        M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS,
      maximumFlattenCancelSubmissions:
        M0_SPOT_MAXIMUM_FLATTEN_CANCEL_SUBMISSIONS,
      maximumLifecycles: 1 as const,
    }),
    filters: Object.freeze({
      state: 'UNKNOWN_NOT_VERIFIED' as const,
      symbolStatus: null,
      baseAsset: null,
      quoteAsset: null,
      spotTradingAllowed: null,
      minPrice: null,
      maxPrice: null,
      minNotional: null,
      maxNotional: null,
      tickSize: null,
      minQuantity: null,
      maxQuantity: null,
      stepSize: null,
      pricePrecision: null,
      quantityPrecision: null,
      activeFilterTypes: null,
      unknownFilterTypes: null,
      allActiveFiltersSatisfied: null,
      completeSnapshotDigest: null,
      observedAtMs: null,
      validUntilMs: null,
      snapshotRevision: null,
    }),
    liquidity: Object.freeze({
      state: 'UNKNOWN_NOT_VERIFIED' as const,
      symbol: null,
      classification: null,
      observedSpreadBps: null,
      maximumSpreadBps: null,
      observedDepthQuote: null,
      minimumDepthQuote: null,
      evidenceDigest: null,
      observedAtMs: null,
      validUntilMs: null,
      evidenceRevision: null,
    }),
    economics: Object.freeze({
      state: 'UNKNOWN_NOT_VERIFIED' as const,
      makerRate: null,
      takerRate: null,
      feeChargingAsset: null,
      discountEnabled: null,
      expectedEntryFeeQuote: null,
      expectedRecoveryFeeQuote: null,
      totalFeeReserveQuote: null,
      maximumSlippageQuote: null,
      observedAtMs: null,
      validUntilMs: null,
      evidenceRevision: null,
    }),
    baseline: Object.freeze({
      state: 'UNKNOWN_NOT_VERIFIED' as const,
      baseAsset: null,
      quoteAsset: null,
      baselineBaseQuantity: null,
      baselineQuoteQuantity: null,
      observedBaseDeltaQuantity: null,
      observedQuoteDeltaQuantity: null,
      exchangeBaseTolerance: null,
      quoteQuantityTolerance: null,
      openOrderCount: null,
      unresolvedMutationCount: null,
      matched: null,
      matchKind: null,
      observedAtMs: null,
      validUntilMs: null,
      baselineRevision: null,
    }),
    clientIdentity: Object.freeze({
      state: 'SOURCE_IMPLEMENTED_NOT_RUNTIME_VERIFIED' as const,
      ticketId: null,
      entryClientOrderId: null,
      termsDigest: null,
      queryKey: 'origClientOrderId' as const,
    }),
    validation: Object.freeze({
      state: 'UNKNOWN_NOT_VERIFIED' as const,
      signedTestPassed: null,
      observedAtMs: null,
      validUntilMs: null,
      evidenceRevision: null,
    }),
    timing: Object.freeze({
      requestTimeoutMs: 5000 as const,
      recvWindowMs: 5000 as const,
      queryBeforeRetry: true as const,
      blindResend: false as const,
    }),
    executorActionAllowlist: M0_SPOT_ACTION_ALLOWLIST,
    recovery: Object.freeze({
      state: 'SOURCE_IMPLEMENTED_NOT_RUNTIME_VERIFIED' as const,
      law:
        'CANCEL_OPEN_REMAINDER_THEN_FLATTEN_EXACT_CANARY_ATTRIBUTABLE_EXPOSURE_UNTIL_BASELINE' as const,
      baselineRevision: null,
      exchangeBaseTolerance: null,
      quoteQuantityTolerance: null,
      maximumResidualDustNotionalQuote:
        M0_SPOT_MAX_RESIDUAL_DUST_NOTIONAL_QUOTE,
      feeReserveQuote: null,
      maximumRecoveryDurationMs: null,
      cancelExactOrderOnly: true as const,
      flattenExactResidualOnly: true as const,
      remainsAuthorizedAfterKill: true as const,
      remainsAuthorizedAcrossRestart: true as const,
    }),
    ledgerReconciliation: Object.freeze({
      state: 'SOURCE_IMPLEMENTED_NOT_RUNTIME_VERIFIED' as const,
      appendOnlyLedger: 'COSMOS_LEDGER' as const,
      requiredEvents: REQUIRED_LEDGER_EVENTS,
      venueEqualsLocal: null,
    }),
    lifecycle: Object.freeze({
      state: 'SOURCE_IMPLEMENTED_NOT_RUNTIME_VERIFIED' as const,
      oneEntry: true as const,
      oneLifecycle: true as const,
      blindResend: false as const,
      recoveryAuthorizedUntilFlat: true as const,
      finalDisarmAfterVenueAndLocalFlat: true as const,
    }),
    rollback: Object.freeze({
      state: 'SOURCE_IMPLEMENTED_NOT_RUNTIME_VERIFIED' as const,
      trigger: 'OWNER_ABORT_OR_PRE_ENTRY_GATE_FAILURE' as const,
      targetState: 'DISARMED_KILL_ENGAGED' as const,
      ownerId: null,
      procedure: null,
      configRevision: null,
      evidenceRevision: null,
      reversesMarketExposure: false as const,
    }),
    residualCondition: 'SOURCE_READY_NOT_RUNTIME_VERIFIED',
    exactLimitation: M0_SPOT_SOURCE_LIMITATION,
    ownerAction: 'NO' as const,
    effects: Object.freeze({
      privateCalls: 0,
      signatures: 0,
      transportCalls: 0,
      authorityConsumptions: 0,
      ledgerWrites: 0,
      orders: 0,
      moneyMutations: 0,
    }),
  });
  return Object.freeze({
    ...withoutDigest,
    readinessDigest: calculateM0SpotReadinessDigest(
      withoutDigest as Omit<M0SpotReadinessCard, 'readinessDigest'>,
    ),
  });
}
