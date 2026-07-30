import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateM0SpotPermissionEnvelopeDigest,
  M0_SPOT_PERMISSION_ENVELOPE_SCHEMA,
} from '../../../dist/binance/m0SpotPermissionTruth.js';
import {
  SPOT_OWNER_SEND_AUTHORITY_SCHEMA,
  SPOT_RISK_EVIDENCE_SCHEMA,
  SPOT_SIGNED_TEST_EVIDENCE_SCHEMA,
  deriveFlattenLeg as deriveCoreFlattenLeg,
} from '../../../dist/foundation/execution/spotCore.js';
import {
  M0_SPOT_ACTION_ALLOWLIST,
  M0_SPOT_ACTION_AUTHORITY_SCHEMA,
  M0_SPOT_LIFECYCLE_CARD_SCHEMA,
  calculateM0SpotIntentDigest,
  calculateM0SpotLifecycleCardDigest,
  deriveM0SpotActionAuthorizationId,
  deriveM0SpotLifecycleCardId,
  deriveM0SpotLifecycleId,
} from '../../../dist/foundation/execution/m0SpotLifecycleCard.js';
import {
  createSpotExecutionTicket,
} from '../../../dist/foundation/execution/spotTicket.js';
import {
  L05_BINANCE_MATRIX_SHA256,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/contracts.js';
import {
  evaluatePrivatePermissions,
} from '../../../dist/liveEdge/adapters/binancePrivateTruth/permissions.js';
import {
  M0_SPOT_EXECUTABLE_ENTRY_EVIDENCE_SCHEMA,
  calculateM0SpotExecutableEntryEvidenceDigest,
  calculateM0SpotReadinessDigest,
  projectM0SpotSourceReadinessCard,
} from '../../../dist/systemIntegration/evidence/m0SpotReadinessCard.js';
import {
  M0_SPOT_LIFECYCLE_CONFIG_KEY,
  M0SpotLifecyclePersistenceAdapter,
} from '../../../dist/systemIntegration/persistence/m0SpotLifecyclePersistenceAdapter.js';
import {
  calculateM0SpotApiKeyFingerprint,
  createM0SpotProductionExecutor,
} from '../../../dist/systemIntegration/production/m0SpotExecutor.js';

const NOW = 1_900_000_000_000;
const MONOTONIC_NOW = 90_000;
const SYMBOL = 'BTCUSDT';
const BASE_ASSET = 'BTC';
const ACCOUNT_ID = 'account-realm-m0';
const ACCOUNT_FINGERPRINT = 'account-fingerprint-m0';
const OWNER_ID = 'owner-account-4';
const READ_API_KEY = 'm0-read-api-key-0001';
const EXECUTION_API_KEY = 'm0-execution-api-key-0001';
const READ_PROFILE = 'read-profile-m0';
const EXECUTION_PROFILE = 'execution-profile-m0';
const REVISION = '0123456789abcdef0123456789abcdef01234567';
const CLOCK_FENCE =
  'm0_clock_fence_0123456789abcdef0123456789abcdef';
const RESTART_CLOCK_FENCE =
  'm0_clock_fence_fedcba9876543210fedcba9876543210';
const ENTRY_ORDER_ID = '101';
const FLATTEN_ORDER_ID = '202';

const IDENTITY = Object.freeze({
  executorId: 'm0-account-4-executor',
  hostId: 'runtime-host',
  bootId: 'boot-0000000000000001',
  processId: 'pid-4004',
  revision: REVISION,
});

const ZERO_EFFECTS = Object.freeze({
  privateCalls: 0,
  signatures: 0,
  transportCalls: 0,
  authorityConsumptions: 0,
  ledgerWrites: 0,
  orders: 0,
  moneyMutations: 0,
});

const FILTERS = Object.freeze([
  Object.freeze({
    filterType: 'PRICE_FILTER',
    minPrice: '0.01',
    maxPrice: '1000000',
    tickSize: '0.01',
  }),
  Object.freeze({
    filterType: 'LOT_SIZE',
    minQty: '0.000001',
    maxQty: '100',
    stepSize: '0.000001',
  }),
  Object.freeze({
    filterType: 'MIN_NOTIONAL',
    minNotional: '5',
    applyToMarket: true,
    avgPriceMins: 5,
  }),
]);

function createClock() {
  return Object.freeze({
    nowMs: () => NOW,
    monotonicMs: () => MONOTONIC_NOW,
    clockFenceId: () => CLOCK_FENCE,
  });
}

function permissionPayload(overrides = {}) {
  return {
    ipRestrict: true,
    enableReading: false,
    enableWithdrawals: false,
    enableInternalTransfer: false,
    enableMargin: false,
    enableFutures: false,
    permitsUniversalTransfer: false,
    enableVanillaOptions: false,
    enableFixApiTrade: false,
    enableFixReadOnly: false,
    enableSpotAndMarginTrading: false,
    enablePortfolioMarginTrading: false,
    ...overrides,
  };
}

function permissionEnvelope(observedNowMs = NOW) {
  const readProfile = {
    profileClass: 'READ_KEY',
    profileId: READ_PROFILE,
    accountRealmId: ACCOUNT_ID,
    accountFingerprintRef: ACCOUNT_FINGERPRINT,
    environment: 'PRODUCTION',
    deployedEgressMatch: true,
    permissions: permissionPayload({ enableReading: true }),
    accountStatus: 'Normal',
    apiTradingLocked: false,
    usdmDualSidePosition: null,
    usdmMultiAssetsMargin: null,
    marginMode: 'UNKNOWN',
  };
  const executionProfile = {
    profileClass: 'EXECUTION_KEY',
    profileId: EXECUTION_PROFILE,
    accountRealmId: ACCOUNT_ID,
    accountFingerprintRef: ACCOUNT_FINGERPRINT,
    environment: 'PRODUCTION',
    deployedEgressMatch: true,
    permissions: permissionPayload({
      enableSpotAndMarginTrading: true,
    }),
    accountStatus: 'Normal',
    apiTradingLocked: false,
    usdmDualSidePosition: null,
    usdmMultiAssetsMargin: null,
    marginMode: 'UNKNOWN',
  };
  const permissionDecisions = evaluatePrivatePermissions({
    matrixSha256: L05_BINANCE_MATRIX_SHA256,
    posture: 'SPOT_NEW_EXPOSURE',
    accountRealmId: ACCOUNT_ID,
    accountFingerprintRef: ACCOUNT_FINGERPRINT,
    readProfile,
    executionProfile,
  });
  const content = {
    schema: M0_SPOT_PERMISSION_ENVELOPE_SCHEMA,
    version: 1,
    accountRealmId: ACCOUNT_ID,
    accountFingerprintRef: ACCOUNT_FINGERPRINT,
    permissionDecisions,
    accountCanTradeEvidence: {
      profileId: READ_PROFILE,
      accountRealmId: ACCOUNT_ID,
      accountFingerprintRef: ACCOUNT_FINGERPRINT,
      permissionRevision: permissionDecisions[0].revision,
      canTrade: true,
      evidenceRevision: 'account-can-trade-v1',
      observedAtMs: observedNowMs - 100,
      validUntilMs: observedNowMs + 4_900,
    },
    readSignerEvidence: {
      endpointClass: 'USER_DATA',
      profileId: READ_PROFILE,
      accountRealmId: ACCOUNT_ID,
      accountFingerprintRef: ACCOUNT_FINGERPRINT,
      permissionRevision: permissionDecisions[0].revision,
      signerFingerprint:
        calculateM0SpotApiKeyFingerprint(READ_API_KEY),
      signerRevision: 'read-signer-v1',
      observedAtMs: observedNowMs - 100,
      validUntilMs: observedNowMs + 4_900,
    },
    executionSignerEvidence: {
      endpointClass: 'TRADE',
      profileId: EXECUTION_PROFILE,
      accountRealmId: ACCOUNT_ID,
      accountFingerprintRef: ACCOUNT_FINGERPRINT,
      permissionRevision: permissionDecisions[1].revision,
      signerFingerprint:
        calculateM0SpotApiKeyFingerprint(EXECUTION_API_KEY),
      signerRevision: 'execution-signer-v1',
      observedAtMs: observedNowMs - 100,
      validUntilMs: observedNowMs + 4_900,
    },
  };
  return Object.freeze({
    ...content,
    evidenceDigest: calculateM0SpotPermissionEnvelopeDigest(content),
  });
}

function entryTicket() {
  return createSpotExecutionTicket({
    correlationId: 'correlation-m0-production-1',
    planId: 'plan-m0-production-1',
    accountId: ACCOUNT_ID,
    symbol: SYMBOL,
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'FOK',
    quantity: '0.001',
    price: '10000',
    riskReferencePrice: '10000',
    estimatedMaxLossQuote: '0.25',
    purpose: 'ENTRY',
    attempt: 0,
    createdAtMs: NOW - 100,
    expiresAtMs: NOW + 60_000,
  });
}

function lifecycleCard(ticket) {
  const cardId = deriveM0SpotLifecycleCardId({
    ownerId: OWNER_ID,
    accountId: ACCOUNT_ID,
    entryTicketId: ticket.ticketId,
    signedTestEvidenceRevision: 'signed-test-v1',
    controlRevision: REVISION,
  });
  const content = Object.freeze({
    schema: M0_SPOT_LIFECYCLE_CARD_SCHEMA,
    version: 1,
    cardId,
    verification: 'VERIFIED_BY_CANONICAL_OWNER_CARD',
    ownerId: OWNER_ID,
    accountId: ACCOUNT_ID,
    symbol: SYMBOL,
    baseAsset: BASE_ASSET,
    side: 'BUY',
    orderType: 'LIMIT',
    quoteAsset: 'USDT',
    entryTicketId: ticket.ticketId,
    entryTermsDigest: ticket.termsDigest,
    entryClientOrderId: ticket.clientOrderId,
    entryNotionalQuote: '10',
    maximumOrderNotionalQuote: '10',
    maximumSimultaneousExposureQuote: '10',
    maximumGrossLifecycleTurnoverQuote: '20',
    maximumResidualDustNotionalQuote: '0.01',
    maximumLossQuote: '0.25',
    maximumExposureDurationMs: 60_000,
    maximumSignedTestSubmissions: 1,
    maximumEntrySubmissions: 1,
    maximumEntryCancelSubmissions: 1,
    maximumFlattenSubmissions: 3,
    maximumFlattenCancelSubmissions: 3,
    recoveryAuthorizedUntil: 'EXACT_FLAT_RECONCILED',
    filterSnapshotRevision: 'filters-v1',
    feeEvidenceRevision: 'fees-v1',
    privateReadRevision: 'api-key-permissions-v1',
    signedTestEvidenceRevision: 'signed-test-v1',
    controlRevision: REVISION,
    clockFenceId: CLOCK_FENCE,
    issuedAtMs: NOW - 100,
    expiresAtMs: NOW + 59_900,
    issuedMonotonicMs: MONOTONIC_NOW - 100,
    expiresMonotonicMs: MONOTONIC_NOW + 59_900,
    oneLifecycle: true,
    actionAllowlist: M0_SPOT_ACTION_ALLOWLIST,
    withdrawalsEnabled: false,
    transfersEnabled: false,
    futuresEnabled: false,
    marginBorrowEnabled: false,
  });
  return Object.freeze({
    ...content,
    cardDigest: calculateM0SpotLifecycleCardDigest(content),
  });
}

function riskEvidence(ticket, recovery = false, request = null) {
  return Object.freeze({
    schema: SPOT_RISK_EVIDENCE_SCHEMA,
    verification: 'VERIFIED_BY_CANONICAL_RISK_OWNER',
    evidenceRevision: `risk-${ticket.ticketId}`,
    policyRevision: 'risk-policy-v1',
    policy: Object.freeze({
      minOrderNotionalQuote: '5',
      maxOrderNotionalQuote: '10',
      maxLossPerOrderQuote: '0.25',
      maxDailyLossQuote: '10',
    }),
    ticketId: ticket.ticketId,
    termsDigest: ticket.termsDigest,
    accountId: ticket.accountId,
    symbol: ticket.symbol,
    observedAtMs: recovery ? NOW : NOW - 100,
    validUntilMs: NOW + 50_000,
    killSwitchEngaged: recovery,
    realizedDailyLossQuote: '0',
    riskReduction: recovery
      ? Object.freeze({
          basis: 'RECONCILED_SPOT_BASE_REDUCTION',
          positionSnapshotRevision: 'position-v1',
          reconciliationStatus: 'EXACT',
          side: 'SELL',
          availableBaseQuantity: ticket.quantity,
          attributableBaseQuantity: ticket.quantity,
          cumulativeFilledSellQuantity:
            request?.previousFlattenAttempts.length === 0 ? '0' : '0',
          cumulativeAuthorizedLifecycleTurnoverQuote: '10',
          maximumAuthorizedLifecycleTurnoverQuote: '20',
          quantityStepSize: '0.000001',
        })
      : null,
  });
}

function ownerAuthority(ticket, suffix) {
  return Object.freeze({
    schema: SPOT_OWNER_SEND_AUTHORITY_SCHEMA,
    authorizationId: `owner-send-${suffix}`,
    verification: 'VERIFIED_BY_CANONICAL_OWNER_AUTHORITY',
    ticketId: ticket.ticketId,
    termsDigest: ticket.termsDigest,
    clientOrderId: ticket.clientOrderId,
    maxOrderNotionalQuote: '10',
    confirmedAtMs: Math.max(NOW - 50, ticket.createdAtMs),
    expiresAtMs: NOW + 50_000,
    singleUse: true,
  });
}

function leg(ticket, { recovery = false, request = null } = {}) {
  return Object.freeze({
    ticket,
    filterSnapshot: Object.freeze({
      revision: 'filters-v1',
      observedAtMs: NOW - 100,
      filters: FILTERS,
    }),
    nowMs: NOW,
    riskEvidence: riskEvidence(ticket, recovery, request),
    venueEvidence: Object.freeze({
      referencePrice: Object.freeze({
        state: 'SET',
        price: '10000',
        providerTimestampMs: NOW - 100,
      }),
      fallbackPrices: Object.freeze([]),
      executionRules: Object.freeze([]),
    }),
    readiness: Object.freeze({
      backupReady: true,
      privateReadReady: true,
      totalFeeReserveQuote: '0.02',
    }),
    signedTestEvidence: recovery
      ? null
      : Object.freeze({
          schema: SPOT_SIGNED_TEST_EVIDENCE_SCHEMA,
          evidenceId: `signed-test-${ticket.ticketId}`,
          status: 'ACCEPTED',
          ticketId: ticket.ticketId,
          termsDigest: ticket.termsDigest,
          clientOrderId: ticket.clientOrderId,
          filterSnapshotRevision: 'filters-v1',
          observedAtMs: NOW - 50,
          createsVenueOrder: false,
        }),
    ownerAuthority: ownerAuthority(
      ticket,
      recovery ? `flatten-${ticket.attempt}` : 'entry',
    ),
  });
}

function entryEvidenceDigest(entry) {
  const authority = entry.ownerAuthority;
  return calculateM0SpotExecutableEntryEvidenceDigest({
    schema: M0_SPOT_EXECUTABLE_ENTRY_EVIDENCE_SCHEMA,
    version: 1,
    ticket: entry.ticket,
    filterSnapshot: entry.filterSnapshot,
    documentaryNowMs: entry.nowMs ?? null,
    riskEvidence: entry.riskEvidence,
    venueEvidence: entry.venueEvidence,
    readiness: entry.readiness,
    signedTestEvidence: entry.signedTestEvidence,
    ownerAuthorityEvidence: authority === null
      ? null
      : {
          schema: authority.schema,
          authorizationId: authority.authorizationId,
          verification: authority.verification,
          ticketId: authority.ticketId,
          termsDigest: authority.termsDigest,
          clientOrderId: authority.clientOrderId,
          maxOrderNotionalQuote: authority.maxOrderNotionalQuote,
          confirmedAtMs: authority.confirmedAtMs,
          expiresAtMs: authority.expiresAtMs,
          singleUse: authority.singleUse,
        },
  });
}

function readyCard(card, entry, envelope) {
  const source = projectM0SpotSourceReadinessCard(NOW - 100);
  const {
    readinessDigest: _readinessDigest,
    ...sourceWithoutDigest
  } = source;
  const readDecision = envelope.permissionDecisions[0];
  const executionDecision = envelope.permissionDecisions[1];
  const content = Object.freeze({
    ...sourceWithoutDigest,
    lifecycleCardDigest: card.cardDigest,
    executableEntryEvidenceDigest: entryEvidenceDigest(entry),
    disposition: 'READY_FOR_OWNER_GATE_2',
    gate2Ready: true,
    evidenceAuthority: 'RUNTIME_PRIVATE',
    ownerId: OWNER_ID,
    validUntilMs: NOW + 4_900,
    revisionHost: Object.freeze({
      state: 'VERIFIED_CURRENT',
      revision: REVISION,
      hostId: IDENTITY.hostId,
      bootId: IDENTITY.bootId,
      processId: IDENTITY.processId,
    }),
    accountMode: Object.freeze({
      state: 'VERIFIED_CURRENT',
      accountId: ACCOUNT_ID,
      accountType: 'SPOT',
      privateReadVerified: true,
      balancesRead: true,
      ordersRead: true,
      fillsRead: true,
      permissionRead: true,
    }),
    accountCanTrade: Object.freeze({
      state: 'VERIFIED_CURRENT',
      profileId: READ_PROFILE,
      accountRealmId: ACCOUNT_ID,
      accountFingerprintRef: ACCOUNT_FINGERPRINT,
      permissionRevision: readDecision.revision,
      value: true,
      observedAtMs: NOW - 100,
      validUntilMs: NOW + 4_900,
      evidenceRevision: 'account-can-trade-v1',
      minimumPermissionTransition: null,
    }),
    apiKeyPermissions: Object.freeze({
      state: 'VERIFIED_CURRENT',
      accountRealmId: ACCOUNT_ID,
      accountFingerprintRef: ACCOUNT_FINGERPRINT,
      evidenceDigest: envelope.evidenceDigest,
      readProfile: Object.freeze({
        profileId: READ_PROFILE,
        permissionRevision: readDecision.revision,
        signerFingerprint:
          calculateM0SpotApiKeyFingerprint(READ_API_KEY),
        signerRevision: 'read-signer-v1',
        observedAtMs: NOW - 100,
        validUntilMs: NOW + 4_900,
      }),
      executionProfile: Object.freeze({
        profileId: EXECUTION_PROFILE,
        permissionRevision: executionDecision.revision,
        signerFingerprint:
          calculateM0SpotApiKeyFingerprint(EXECUTION_API_KEY),
        signerRevision: 'execution-signer-v1',
        observedAtMs: NOW - 100,
        validUntilMs: NOW + 4_900,
      }),
      readingEnabled: true,
      spotTradeEnabled: true,
      ipRestricted: true,
      withdrawalsEnabled: false,
      internalTransfersEnabled: false,
      universalTransfersEnabled: false,
      marginEnabled: false,
      futuresEnabled: false,
      vanillaOptionsEnabled: false,
      fixTradeEnabled: false,
      fixReadOnlyEnabled: false,
      portfolioMarginEnabled: false,
      observedAtMs: NOW - 100,
      validUntilMs: NOW + 4_900,
      evidenceRevision: 'api-key-permissions-v1',
    }),
    appExecutionArmed: Object.freeze({
      state: 'VERIFIED_CURRENT',
      current: false,
      proposed: 'ARM_EXACT_CARD_AFTER_OWNER_YES',
    }),
    excludedCapabilities: Object.freeze({
      ...source.excludedCapabilities,
      state: 'VERIFIED_CURRENT',
    }),
    venueRoutes: Object.freeze({
      ...source.venueRoutes,
      compositionState: 'VERIFIED_CURRENT',
    }),
    namedExecutor: Object.freeze({
      state: 'VERIFIED_CURRENT',
      ...IDENTITY,
      revision: undefined,
      authority: 'EXACT_CARD_ONE_LIFECYCLE',
    }),
    order: Object.freeze({
      state: 'VERIFIED_CURRENT',
      symbol: SYMBOL,
      baseAsset: BASE_ASSET,
      allowlist: Object.freeze([SYMBOL]),
      side: 'BUY',
      orderType: 'LIMIT',
      timeInForce: 'FOK',
      quoteAsset: 'USDT',
      price: entry.ticket.price,
      quoteAmount: '10',
      baseQuantity: entry.ticket.quantity,
    }),
    limits: Object.freeze({
      maximumOrderNotionalQuote: '10',
      maximumSimultaneousExposureQuote: '10',
      maximumGrossLifecycleTurnoverQuote: '20',
      maximumLossQuote: '0.25',
      maximumExposureDurationMs: 60_000,
      maximumResidualDustNotionalQuote: '0.01',
      maximumSignedTestSubmissions: 1,
      maximumEntrySubmissions: 1,
      maximumEntryCancelSubmissions: 1,
      maximumFlattenSubmissions: 3,
      maximumFlattenCancelSubmissions: 3,
      maximumLifecycles: 1,
    }),
    filters: Object.freeze({
      state: 'VERIFIED_CURRENT',
      symbolStatus: 'TRADING',
      baseAsset: BASE_ASSET,
      quoteAsset: 'USDT',
      spotTradingAllowed: true,
      minPrice: '0.01',
      maxPrice: '1000000',
      minNotional: '5',
      maxNotional: null,
      tickSize: '0.01',
      minQuantity: '0.000001',
      maxQuantity: '100',
      stepSize: '0.000001',
      pricePrecision: 2,
      quantityPrecision: 6,
      activeFilterTypes: Object.freeze([
        'PRICE_FILTER',
        'LOT_SIZE',
        'MIN_NOTIONAL',
      ]),
      unknownFilterTypes: Object.freeze([]),
      allActiveFiltersSatisfied: true,
      completeSnapshotDigest: `sha256:${'f'.repeat(64)}`,
      observedAtMs: NOW - 100,
      validUntilMs: NOW + 4_900,
      snapshotRevision: 'filters-v1',
    }),
    liquidity: Object.freeze({
      state: 'VERIFIED_CURRENT',
      symbol: SYMBOL,
      classification: 'LIQUID',
      observedSpreadBps: '1',
      maximumSpreadBps: '5',
      observedDepthQuote: '100',
      minimumDepthQuote: '20',
      evidenceDigest: `sha256:${'e'.repeat(64)}`,
      observedAtMs: NOW - 100,
      validUntilMs: NOW + 4_900,
      evidenceRevision: 'liquidity-v1',
    }),
    economics: Object.freeze({
      state: 'VERIFIED_CURRENT',
      makerRate: '0.001',
      takerRate: '0.001',
      feeChargingAsset: 'USDT',
      discountEnabled: false,
      expectedEntryFeeQuote: '0.01',
      expectedRecoveryFeeQuote: '0.01',
      totalFeeReserveQuote: '0.02',
      maximumSlippageQuote: '0.05',
      observedAtMs: NOW - 100,
      validUntilMs: NOW + 4_900,
      evidenceRevision: 'fees-v1',
    }),
    baseline: Object.freeze({
      state: 'VERIFIED_CURRENT',
      baseAsset: BASE_ASSET,
      quoteAsset: 'USDT',
      baselineBaseQuantity: '0',
      baselineQuoteQuantity: '100',
      observedBaseDeltaQuantity: '0',
      observedQuoteDeltaQuantity: '0',
      exchangeBaseTolerance: '0.00000001',
      quoteQuantityTolerance: '0.01',
      openOrderCount: 0,
      unresolvedMutationCount: 0,
      matched: true,
      matchKind: 'EXACT',
      observedAtMs: NOW - 100,
      validUntilMs: NOW + 4_900,
      baselineRevision: 'baseline-v1',
    }),
    clientIdentity: Object.freeze({
      state: 'VERIFIED_CURRENT',
      ticketId: entry.ticket.ticketId,
      entryClientOrderId: entry.ticket.clientOrderId,
      termsDigest: entry.ticket.termsDigest,
      queryKey: 'origClientOrderId',
    }),
    validation: Object.freeze({
      state: 'VERIFIED_CURRENT',
      signedTestPassed: true,
      observedAtMs: NOW - 100,
      validUntilMs: NOW + 4_900,
      evidenceRevision: 'signed-test-v1',
    }),
    recovery: Object.freeze({
      ...source.recovery,
      state: 'VERIFIED_CURRENT',
      baselineRevision: 'baseline-v1',
      exchangeBaseTolerance: '0.00000001',
      quoteQuantityTolerance: '0.01',
      maximumResidualDustNotionalQuote: '0.01',
      feeReserveQuote: '0.02',
      maximumRecoveryDurationMs: 60_000,
    }),
    ledgerReconciliation: Object.freeze({
      ...source.ledgerReconciliation,
      state: 'VERIFIED_CURRENT',
      venueEqualsLocal: true,
    }),
    lifecycle: Object.freeze({
      ...source.lifecycle,
      state: 'VERIFIED_CURRENT',
    }),
    rollback: Object.freeze({
      state: 'VERIFIED_CURRENT',
      trigger: 'OWNER_ABORT_OR_PRE_ENTRY_GATE_FAILURE',
      targetState: 'DISARMED_KILL_ENGAGED',
      ownerId: OWNER_ID,
      procedure:
        'runtime-config:m0-spot-execution=DISARMED;kill-switch=ENGAGED',
      configRevision: 'runtime-config-v1',
      evidenceRevision: 'rollback-v1',
      reversesMarketExposure: false,
    }),
    residualCondition: 'EXACT_ZERO_DELTA_BASELINE_VERIFIED',
    exactLimitation: null,
    ownerAction: 'YES',
  });
  const namedExecutor = Object.freeze({
    state: content.namedExecutor.state,
    executorId: content.namedExecutor.executorId,
    hostId: content.namedExecutor.hostId,
    bootId: content.namedExecutor.bootId,
    processId: content.namedExecutor.processId,
    authority: content.namedExecutor.authority,
  });
  const exactContent = Object.freeze({ ...content, namedExecutor });
  return Object.freeze({
    ...exactContent,
    readinessDigest: calculateM0SpotReadinessDigest(exactContent),
  });
}

function actionForOperation(operation, ticket) {
  if (operation === 'SIGNED_TEST') return 'SIGNED_TEST';
  if (operation === 'SUBMIT') return 'ENTRY';
  if (operation === 'QUERY_ORDER') return 'QUERY_ORDER';
  if (operation === 'QUERY_FILLS') return 'QUERY_FILLS';
  if (operation === 'FLATTEN') return 'FLATTEN';
  return ticket.purpose === 'FLATTEN'
    ? 'FLATTEN_CANCEL'
    : 'ENTRY_CANCEL';
}

function ticketForIntent(intent, state) {
  if (intent.kind === 'FLATTEN') return intent.flattenTicket;
  if (
    intent.kind === 'SIGNED_TEST_ORDER'
    || intent.kind === 'SUBMIT_LIVE_ORDER'
  ) return state.entryTicket;
  if (
    state.flattenTicket !== null
    && intent.originalClientOrderId === state.flattenTicket.clientOrderId
  ) return state.flattenTicket;
  return state.entryTicket;
}

function createActionOwner(clock) {
  function authority(action, ticket, intent, state) {
    const intentDigest = calculateM0SpotIntentDigest(intent);
    const lifecycleId = deriveM0SpotLifecycleId(state.card.cardDigest);
    return Object.freeze({
      schema: M0_SPOT_ACTION_AUTHORITY_SCHEMA,
      version: 1,
      authorizationId: deriveM0SpotActionAuthorizationId({
        lifecycleId,
        action,
        ticketId: ticket.ticketId,
        intentDigest,
        stateRevision: state.revision,
      }),
      verification: 'VERIFIED_BY_CANONICAL_LIFECYCLE_OWNER',
      lifecycleId,
      cardId: state.card.cardId,
      cardDigest: state.card.cardDigest,
      action,
      ticketId: ticket.ticketId,
      termsDigest: ticket.termsDigest,
      clientOrderId: ticket.clientOrderId,
      intentDigest,
      stateRevision: state.revision,
      clockFenceId: clock.clockFenceId(),
      issuedAtMs: clock.nowMs() - 10,
      expiresAtMs: clock.nowMs() + 10_000,
      issuedMonotonicMs: clock.monotonicMs() - 10,
      expiresMonotonicMs: clock.monotonicMs() + 10_000,
      singleUse: true,
    });
  }
  return Object.freeze({
    resolve(input, state) {
      const ticket = ticketForIntent(input.intent, state);
      const action = actionForOperation(input.operation, ticket);
      return Object.freeze({
        action,
        ticket,
        authority: authority(action, ticket, input.intent, state),
      });
    },
    resolveReservedMutation(input) {
      return authority(
        input.action,
        input.ticket,
        input.intent,
        input.state,
      );
    },
  });
}

class MemoryLedger {
  #config = new Map();
  #events = [];
  #fills = new Map();

  getConfigValue(key) {
    return this.#config.get(key) ?? null;
  }

  compareAndSetConfigValueAndLogEvents(
    key,
    expectedValue,
    nextValue,
    records,
  ) {
    const currentValue = this.getConfigValue(key);
    if (currentValue !== expectedValue) {
      return Object.freeze({
        committed: false,
        reason: 'VERSION_CONFLICT',
        currentValue,
      });
    }
    this.#config.set(key, nextValue);
    const events = records.map((record) => Object.freeze({
      id: this.#events.length + 1,
      ts: NOW,
      kind: record.kind,
      symbol: record.symbol ?? null,
      data: record.data,
    }));
    this.#events.push(...events);
    return Object.freeze({
      committed: true,
      events: Object.freeze(events),
    });
  }

  insertFill(input) {
    const key = `${input.symbol}:${input.tradeId}`;
    const canonical = JSON.stringify(input);
    const prior = this.#fills.get(key);
    if (prior === undefined) {
      this.#fills.set(key, canonical);
      return true;
    }
    if (prior === canonical) return false;
    throw new Error('FILL_IDENTITY_CONFLICT');
  }

  readDurableMutationAuthority() {
    const requests = this.#events.filter(
      (event) => event.kind === 'order_request',
    );
    const reconciled = new Set(
      this.#events
        .filter((event) =>
          event.kind === 'order_response'
          && typeof event.data?.reservationId === 'string'
          && typeof event.data?.outcome === 'string'
          && event.data.outcome.endsWith('_reconciled'))
        .map((event) => event.data.reservationId),
    );
    return Object.freeze({
      posture: requests.every((event) =>
        reconciled.has(event.data?.reservationId))
        ? 'PROVEN_ABSENT'
        : 'AMBIGUOUS',
      unresolvedOrderCount: requests.filter((event) =>
        !reconciled.has(event.data?.reservationId)).length,
      malformedOrderRowCount: 0,
      readErrorCount: 0,
    });
  }
}

function ledgerPort(ledger) {
  return Object.freeze({
    getConfigValue: (key) => ledger.getConfigValue(key),
    compareAndSetConfigValueAndLogEvents: (...args) =>
      ledger.compareAndSetConfigValueAndLogEvents(...args),
    insertFill: (value) => ledger.insertFill(value),
    readDurableMutationAuthority: () =>
      ledger.readDurableMutationAuthority(),
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function venue(state) {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const clientOrderId =
      url.searchParams.get('newClientOrderId')
      ?? url.searchParams.get('origClientOrderId');
    const side = url.searchParams.get('side');
    const orderId = url.searchParams.get('orderId');
    state.calls.push({
      method,
      path: url.pathname,
      clientOrderId,
      side,
      orderId,
      apiKey: init?.headers?.['X-MBX-APIKEY'] ?? null,
    });
    if (url.pathname === '/api/v3/order/test') return json({});
    if (url.pathname === '/api/v3/order' && method === 'POST') {
      if (side === 'BUY' && state.phase === 'unknown') {
        return json({ code: -1007, msg: 'Execution status unknown' }, 504);
      }
      const flatten = side === 'SELL';
      return json({
        symbol: SYMBOL,
        clientOrderId,
        orderId: Number(flatten ? FLATTEN_ORDER_ID : ENTRY_ORDER_ID),
        status: 'FILLED',
        executedQty: '0.001',
      });
    }
    if (url.pathname === '/api/v3/order' && method === 'GET') {
      if (state.phase === 'unknown') {
        return json({ code: -1007, msg: 'Execution status unknown' }, 504);
      }
      const flatten = clientOrderId !== state.entryClientOrderId;
      return json({
        symbol: SYMBOL,
        clientOrderId,
        orderId: Number(flatten ? FLATTEN_ORDER_ID : ENTRY_ORDER_ID),
        status: 'FILLED',
        executedQty: '0.001',
      });
    }
    if (url.pathname === '/api/v3/myTrades' && method === 'GET') {
      const flatten = orderId === FLATTEN_ORDER_ID;
      return json([{
        symbol: SYMBOL,
        id: Number(flatten ? 1002 : 1001),
        orderId: Number(flatten ? FLATTEN_ORDER_ID : ENTRY_ORDER_ID),
        price: '10000',
        qty: '0.001',
        quoteQty: '10',
        commission: '0',
        commissionAsset: 'USDT',
        time: NOW,
      }]);
    }
    throw new Error(`unexpected request ${method} ${url.pathname}`);
  };
}

function exactFlatEvidence(request, occurredAtMs = NOW) {
  return Object.freeze({
    revision: `flat-evidence-exact-${occurredAtMs}`,
    sourceTicketId: request.sourceTicket.ticketId,
    sourceClientOrderId: request.sourceTicket.clientOrderId,
    sourceVenueOrderId: request.lifecycle.venueOrderId,
    sourceOrderAuthoritativelyAbsent:
      request.sourceOrderAuthoritativelyAbsent,
    sourceOpenOrderAbsent: true,
    sourceOrderTerminal: true,
    sourceFillsComplete: true,
    sourceCumulativeFilledQuantity:
      request.lifecycle.cumulativeFilledQuantity,
    flattenTicketId: request.flattenTicket?.ticketId ?? null,
    flattenClientOrderId: request.flattenTicket?.clientOrderId ?? null,
    flattenVenueOrderId:
      request.flattenAttempts.at(-1)?.venueOrderId ?? null,
    flattenOrderTerminal: true,
    flattenFillsComplete: true,
    flattenCumulativeFilledQuantity:
      request.lifecycle.cumulativeFlattenedQuantity,
    baseAsset: request.baseAsset,
    baselineRevision: request.baselineRevision,
    baselineBaseQuantity: request.baselineBaseQuantity,
    observedBaseQuantity: request.baselineBaseQuantity,
    exchangeBaseTolerance: request.exchangeBaseTolerance,
    maximumResidualDustNotionalQuote:
      request.maximumResidualDustNotionalQuote,
    residualDustNotionalQuote:
      request.expectedResidualDustNotionalQuote,
    sourceBaseCommissionQuantity:
      request.sourceBaseCommissionQuantity,
    flattenBaseCommissionQuantity:
      request.flattenBaseCommissionQuantity,
    canaryAttributableBaseDeltaQuantity:
      request.expectedCanaryAttributableBaseDeltaQuantity,
    flattenAttemptCount: request.flattenAttempts.length,
    allFlattenOrdersTerminal: true,
    allFlattenFillsComplete: true,
    flattenOpenOrdersAbsent: true,
    authoritativelyAbsentFlattenClientOrderIds:
      request.authoritativelyAbsentFlattenClientOrderIds,
    canonicalStatus: 'EXACT',
    ledgerState: 'MATCHED',
    quoteAsset: request.quoteAsset,
    baselineQuoteQuantity: request.baselineQuoteQuantity,
    observedQuoteQuantity: request.baselineQuoteQuantity,
    quoteQuantityTolerance: request.quoteQuantityTolerance,
    observedQuoteDelta: request.fillDerivedQuoteCashflow,
    sourceGrossQuoteDebit: request.sourceGrossQuoteDebit,
    flattenGrossQuoteCredit: request.flattenGrossQuoteCredit,
    observedGrossLifecycleTurnoverQuote:
      request.observedGrossLifecycleTurnoverQuote,
    authorizedFilledLifecycleTurnoverQuote:
      request.authorizedFilledLifecycleTurnoverQuote,
    favorableSellPriceImprovementQuote:
      request.favorableSellPriceImprovementQuote,
    referencePnlQuote: request.referencePnlQuote,
    signedSlippageCostQuote: request.signedSlippageCostQuote,
    quoteCommissionDebit: request.quoteCommissionDebit,
    fillDerivedQuoteCashflow: request.fillDerivedQuoteCashflow,
    realizedPnlAfterQuoteFees: request.realizedPnlAfterQuoteFees,
    quoteEquationResidual: Object.freeze({
      direction: 'ZERO',
      quantity: '0',
    }),
    commissionTotals: request.commissionTotals,
    quoteCashflowStatus: 'EXACT_WITHIN_TOLERANCE',
    quoteEconomicsStatus: request.quoteEconomicsStatus,
    thirdAssetCommissionQuoteValueStatus:
      request.thirdAssetCommissionQuoteValueStatus,
    thirdAssetCommissionQuoteValue: null,
    thirdAssetValuationDigest: null,
    occurredAtMs,
  });
}

function createWorld({
  phase = 'complete',
  blockEntry = false,
  mutateBundle = (value) => value,
} = {}) {
  const ledger = new MemoryLedger();
  const clock = createClock();
  const ticket = entryTicket();
  const card = lifecycleCard(ticket);
  const entry = leg(ticket);
  const envelope = permissionEnvelope();
  const readiness = readyCard(card, entry, envelope);
  const actionOwner = createActionOwner(clock);
  const state = {
    phase,
    calls: [],
    entryClientOrderId: ticket.clientOrderId,
  };
  const readSigner = Object.freeze({
    algorithm: 'HMAC_SHA256',
    apiKey: READ_API_KEY,
    sign: async () => 'a'.repeat(64),
  });
  const executionSigner = Object.freeze({
    algorithm: 'HMAC_SHA256',
    apiKey: EXECUTION_API_KEY,
    sign: async () => 'b'.repeat(64),
  });
  const baseBundle = Object.freeze({
    card,
    entry,
    flatten: null,
    permissionEnvelope: envelope,
    readSigner,
    executionSigner,
    actionOwner,
    readAdmission: (_symbol, action) => Object.freeze(
      action === 'ENTRY'
        ? {
            revision: 'entry-admission-v1',
            sourceEnabled: !blockEntry,
            killSwitchEngaged: blockEntry,
            allowedSymbols: blockEntry ? [] : [SYMBOL],
            blockedSymbols: blockEntry ? [SYMBOL] : [],
          }
        : {
            revision: 'recovery-admission-v1',
            sourceEnabled: false,
            killSwitchEngaged: true,
            allowedSymbols: [SYMBOL],
            blockedSymbols: [],
            recoveryAuthorizedUntilFlat: true,
          },
    ),
    verifySignedTestEvidence: async (intent, outcome, evidence) =>
      outcome.kind === 'ACKNOWLEDGED'
      && outcome.venueOrderId === null
      && outcome.cumulativeFilledQuantity === '0'
      && evidence?.ticketId === intent.ticketId
      && evidence.createsVenueOrder === false,
    readFlatEvidence: async (request) =>
      exactFlatEvidence(request, clock.nowMs()),
    deriveFlattenLeg(request) {
      if (request.attempt < 1 || request.attempt > 3) return null;
      const derived = deriveCoreFlattenLeg({
        sourceTicket: request.sourceTicket,
        sourceVenueOrderId: request.sourceVenueOrderId,
        sourceFills: request.sourceFills,
        previousFlattenAttempts: request.previousFlattenAttempts.map(
          (attempt) => ({
            ticket: attempt.ticket,
            venueOrderId: attempt.venueOrderId,
            authoritativelyAbsent: attempt.authoritativelyAbsent,
            fills: attempt.fills,
          }),
        ),
        baseAsset: request.baseAsset,
        exchangeBaseTolerance: request.exchangeBaseTolerance,
        maximumResidualDustNotionalQuote:
          request.maximumResidualDustNotionalQuote,
        maximumGrossLifecycleTurnoverQuote:
          request.maximumGrossLifecycleTurnoverQuote,
        totalFeeReserveQuote: request.totalFeeReserveQuote,
        quantityStepSize: '0.000001',
        attempt: request.attempt,
        price: '10000',
        riskReferencePrice: request.sourceTicket.riskReferencePrice,
        estimatedMaxLossQuote: request.sourceTicket.estimatedMaxLossQuote,
        createdAtMs: NOW,
        expiresAtMs: request.sourceTicket.expiresAtMs,
      });
      if (derived.ticket === null) return null;
      const base = leg(derived.ticket, { recovery: true, request });
      const result = Object.freeze({
        ...base,
        riskEvidence: Object.freeze({
          ...base.riskEvidence,
          riskReduction: Object.freeze({
            basis: 'RECONCILED_SPOT_BASE_REDUCTION',
            positionSnapshotRevision: 'position-v1',
            reconciliationStatus: 'EXACT',
            side: 'SELL',
            availableBaseQuantity: derived.sellQuantity,
            attributableBaseQuantity:
              derived.attributableBaseQuantity,
            cumulativeFilledSellQuantity:
              derived.cumulativeFilledSellQuantity,
            cumulativeAuthorizedLifecycleTurnoverQuote:
              derived.authorizedFilledLifecycleTurnoverQuote,
            maximumAuthorizedLifecycleTurnoverQuote:
              derived.maximumAuthorizedLifecycleTurnoverQuote,
            quantityStepSize: derived.quantityStepSize,
          }),
        }),
      });
      return result;
    },
  });
  const bundle = mutateBundle(baseBundle);
  const port = ledgerPort(ledger);
  const venueFetch = venue(state);
  const executor = createM0SpotProductionExecutor({
    ledger: port,
    clock,
    fetch: venueFetch,
    resolveBundle: Object.freeze({
      resolve: async () => bundle,
      resolveRecovery: async () => bundle,
    }),
    identity: IDENTITY,
  });
  let restartNowMs = NOW;
  let restartMonotonicMs = 1_000;
  const restartExecutor = () => {
    const restartClock = Object.freeze({
      nowMs: () => restartNowMs,
      monotonicMs: () => restartMonotonicMs,
      clockFenceId: () => RESTART_CLOCK_FENCE,
    });
    const restartIdentity = Object.freeze({
      ...IDENTITY,
      bootId: 'boot-0000000000000002',
      processId: 'pid-5005',
    });
    const restartActionOwner = createActionOwner(restartClock);
    const resolveRestartBundle = () => Object.freeze({
      ...bundle,
      permissionEnvelope: permissionEnvelope(restartNowMs),
      actionOwner: restartActionOwner,
      readFlatEvidence: async (request) =>
        exactFlatEvidence(request, restartClock.nowMs()),
    });
    return createM0SpotProductionExecutor({
      ledger: port,
      clock: restartClock,
      fetch: venueFetch,
      resolveBundle: Object.freeze({
        resolve: async () => resolveRestartBundle(),
        resolveRecovery: async () => resolveRestartBundle(),
      }),
      identity: restartIdentity,
    });
  };
  return {
    ledger,
    port,
    clock,
    ticket,
    card,
    entry,
    readiness,
    bundle,
    state,
    executor,
    restartExecutor,
    advanceRestartClock: (elapsedMs) => {
      restartNowMs += elapsedMs;
      restartMonotonicMs += elapsedMs;
    },
  };
}

function executionInput(world, overrides = {}) {
  return Object.freeze({
    requestId: `m0_req_${'1'.repeat(32)}`,
    idempotencyKeyDigest: `sha256:${'2'.repeat(64)}`,
    operatorId: OWNER_ID,
    cardDigest: world.readiness.readinessDigest,
    ownerConfirmation: 'YES',
    action: 'EXECUTE_APPROVED_LIFECYCLE',
    lifecycleCardDigest: world.card.cardDigest,
    executableEntryEvidenceDigest:
      world.readiness.executableEntryEvidenceDigest,
    readinessCard: world.readiness,
    ...overrides,
  });
}

function persistedState(world) {
  const raw = world.ledger.getConfigValue(M0_SPOT_LIFECYCLE_CONFIG_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function assertNoAuthority(result) {
  assert.equal(result.executionAuthorityReturned, 'NONE');
  assert.equal(Object.hasOwn(result, 'executionAuthority'), false);
  assert.equal(Object.hasOwn(result, 'dispatchPermit'), false);
  assert.equal(Object.hasOwn(result, 'signer'), false);
  assert.equal(Object.hasOwn(result, 'credential'), false);
}

test('hostile bundle accessors, proxies, and cycles cannot arm, sign, or reach transport', async () => {
  let hostileReads = 0;
  const accessorWorld = createWorld({
    mutateBundle: (bundle) => {
      const descriptors = Object.getOwnPropertyDescriptors(bundle);
      descriptors.card = {
        enumerable: true,
        configurable: false,
        get() {
          hostileReads += 1;
          return bundle.card;
        },
      };
      return Object.defineProperties({}, descriptors);
    },
  });
  const accessorResult =
    await accessorWorld.executor.execute(executionInput(accessorWorld));
  assert.equal(hostileReads, 0, 'bundle accessors must never execute');
  assert.equal(accessorResult.code, 'M0_CARD_NOT_READY');
  assert.deepEqual(accessorResult.effects, ZERO_EFFECTS);
  assert.deepEqual(accessorWorld.state.calls, []);
  assert.equal(persistedState(accessorWorld), null);

  let proxyTrapCalls = 0;
  const proxyWorld = createWorld({
    mutateBundle: (bundle) => Object.freeze({
      ...bundle,
      permissionEnvelope: new Proxy(bundle.permissionEnvelope, {
        get(target, property, receiver) {
          proxyTrapCalls += 1;
          return Reflect.get(target, property, receiver);
        },
      }),
    }),
  });
  const proxyResult =
    await proxyWorld.executor.execute(executionInput(proxyWorld));
  assert.equal(proxyTrapCalls, 0, 'proxy traps must never execute');
  assert.equal(proxyResult.code, 'M0_CARD_NOT_READY');
  assert.deepEqual(proxyResult.effects, ZERO_EFFECTS);
  assert.deepEqual(proxyWorld.state.calls, []);
  assert.equal(persistedState(proxyWorld), null);

  const cycle = {};
  cycle.self = cycle;
  const cyclicWorld = createWorld({
    mutateBundle: (bundle) => Object.freeze({
      ...bundle,
      entry: Object.freeze({
        ...bundle.entry,
        hostileCycle: cycle,
      }),
    }),
  });
  const cyclicResult =
    await cyclicWorld.executor.execute(executionInput(cyclicWorld));
  assert.equal(cyclicResult.code, 'M0_CARD_NOT_READY');
  assert.deepEqual(cyclicResult.effects, ZERO_EFFECTS);
  assert.deepEqual(cyclicWorld.state.calls, []);
  assert.equal(persistedState(cyclicWorld), null);
});

test('plain YES without the exact executable-evidence acknowledgement is inert', async () => {
  const world = createWorld();
  const result = await world.executor.execute(executionInput(world, {
    executableEntryEvidenceDigest: `sha256:${'0'.repeat(64)}`,
  }));
  assert.equal(result.code, 'M0_CARD_NOT_READY');
  assert.equal(result.state, 'DISARMED');
  assert.deepEqual(result.effects, ZERO_EFFECTS);
  assert.deepEqual(world.state.calls, []);
  assert.equal(persistedState(world), null);
  assertNoAuthority(result);
});

test('a card/readiness residual-dust ceiling mismatch blocks before arm', async () => {
  const world = createWorld({
    mutateBundle: (bundle) => Object.freeze({
      ...bundle,
      card: Object.freeze({
        ...bundle.card,
        maximumResidualDustNotionalQuote: '0.02',
      }),
    }),
  });
  const result = await world.executor.execute(executionInput(world));
  assert.equal(result.code, 'M0_CARD_NOT_READY');
  assert.equal(result.state, 'DISARMED');
  assert.deepEqual(result.effects, ZERO_EFFECTS);
  assert.deepEqual(world.state.calls, []);
  assert.equal(persistedState(world), null);
});

test('a pre-entry gate failure durably disarms no exposure and parks its lease', async () => {
  const world = createWorld({ blockEntry: true });
  const result = await world.executor.execute(executionInput(world));
  assert.equal(result.code, 'M0_CARD_NOT_READY');
  assert.equal(result.state, 'DISARMED');
  assert.equal(result.effects.privateCalls, 0);
  assert.equal(result.effects.orders, 0);
  assert.equal(result.effects.moneyMutations, 0);
  const state = persistedState(world);
  assert.equal(state.phase, 'DISARMED_NO_EXPOSURE');
  assert.equal(state.lifecycleLock, 'RELEASED');
  assert.equal(state.newEntryArmed, false);
  assert.equal(state.entry, null);
  assert.equal(state.execution.status, 'PARKED');
  assertNoAuthority(result);
});

test('boot recovery disarms a crash-persisted arm with no entry and never uses transport', async () => {
  const world = createWorld();
  const seeded = new M0SpotLifecyclePersistenceAdapter({
    ledger: world.port,
    clock: world.clock,
    resolveAction: Object.freeze({ resolve: () => null }),
  }).armLifecycle(world.card, world.ticket, world.readiness);
  assert.equal(
    seeded.disposition,
    'COMMITTED_NEW',
    JSON.stringify(seeded),
  );

  const result = await world.restartExecutor().recoverOnBoot();
  assert.equal(result.code, 'M0_CARD_NOT_READY');
  assert.equal(result.state, 'DISARMED');
  assert.equal(result.effects.privateCalls, 0);
  assert.equal(result.effects.orders, 0);
  assert.equal(result.effects.moneyMutations, 0);
  assert.deepEqual(world.state.calls, []);
  const state = persistedState(world);
  assert.equal(state.phase, 'DISARMED_NO_EXPOSURE');
  assert.equal(state.execution.status, 'PARKED');
  assertNoAuthority(result);
});

test('an ambiguous entry is queried, never resent, and boot recovery uses the persisted card to flatten and disarm', async () => {
  const world = createWorld({ phase: 'unknown' });
  const first = await world.executor.execute(executionInput(world));
  assert.equal(
    first.code,
    'M0_LIFECYCLE_RECOVERY_REQUIRED',
    JSON.stringify({
      first,
      calls: world.state.calls,
      persisted: persistedState(world),
    }),
  );
  assert.equal(first.state, 'RECOVERY_REQUIRED');
  assert.equal(first.queryBeforeRetry, true);
  assert.equal(first.blindResend, false);
  assertNoAuthority(first);
  let state = persistedState(world);
  assert.equal(state.phase, 'RECOVERY_REQUIRED');
  assert.equal(state.newEntryArmed, false);
  assert.equal(state.execution.status, 'PARKED');
  assert.equal(
    world.state.calls.filter((call) =>
      call.method === 'POST'
      && call.path === '/api/v3/order'
      && call.side === 'BUY').length,
    1,
  );

  world.state.phase = 'complete';
  const restartExecutor = world.restartExecutor();
  const acceptancePending = await restartExecutor.recoverOnBoot();
  assert.equal(
    acceptancePending.code,
    'M0_LIFECYCLE_RECOVERY_REQUIRED',
    JSON.stringify(acceptancePending),
  );
  assert.equal(acceptancePending.state, 'RECOVERY_REQUIRED');
  assertNoAuthority(acceptancePending);

  world.advanceRestartClock(11_001);
  const recovered = await restartExecutor.recoverOnBoot();
  assert.equal(
    recovered.code,
    'M0_LIFECYCLE_RECONCILED',
    JSON.stringify({
      recovered,
      calls: world.state.calls,
      state: persistedState(world),
    }),
  );
  assert.equal(recovered.state, 'DISARMED_SAFE');
  assert.equal(recovered.ok, true);
  assertNoAuthority(recovered);
  assert.equal(
    world.state.calls.filter((call) =>
      call.method === 'POST'
      && call.path === '/api/v3/order'
      && call.side === 'BUY').length,
    1,
    'recovery must never submit a second entry',
  );
  assert.equal(
    world.state.calls.filter((call) =>
      call.method === 'POST'
      && call.path === '/api/v3/order'
      && call.side === 'SELL').length,
    1,
  );
  const readCalls = world.state.calls.filter((call) =>
    call.method === 'GET');
  const mutationCalls = world.state.calls.filter((call) =>
    call.method !== 'GET');
  assert.equal(
    readCalls.every((call) => call.apiKey === READ_API_KEY),
    true,
  );
  assert.equal(
    mutationCalls.every((call) => call.apiKey === EXECUTION_API_KEY),
    true,
  );
  state = persistedState(world);
  assert.equal(state.phase, 'DISARMED_SAFE');
  assert.equal(state.lifecycleLock, 'RELEASED');
  assert.equal(state.execution.status, 'PARKED');
  assert.equal(state.reconciliation.canonicalStatus, 'EXACT');
  assert.equal(state.reconciliation.ledgerState, 'MATCHED');
});
