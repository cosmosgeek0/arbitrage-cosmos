import assert from 'node:assert/strict';
import test from 'node:test';

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
  addSpotDecimals,
  multiplySpotDecimals,
  subtractSpotDecimals,
} from '../../../dist/foundation/exchange/binanceSpot/filters.js';
import {
  deriveSpotQuoteAccounting,
} from '../../../dist/foundation/execution/spotTransportCoordinator.js';
import {
  BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
} from '../../../dist/foundation/execution/m0SpotDispatch.js';
import {
  M0SpotLifecyclePersistenceAdapter,
} from '../../../dist/systemIntegration/persistence/m0SpotLifecyclePersistenceAdapter.js';
import {
  createM0SpotProductionTransport,
} from '../../../dist/liveEdge/adapters/binanceSpotExecution/productionTransport.js';
import {
  calculateM0SpotReadinessDigest,
  projectM0SpotSourceReadinessCard,
} from '../../../dist/systemIntegration/evidence/m0SpotReadinessCard.js';
import {
  BoundedInMemoryLedger,
} from '../fixtures/memory-ledger.mjs';

const T0 = 1_900_000_000_000;
const MONOTONIC_T0 = 50_000;
const CLOCK_FENCE = 'm0_clock_fence_persistence-test-0001';

function testClock() {
  return Object.freeze({
    nowMs: () => T0,
    monotonicMs: () => MONOTONIC_T0,
    clockFenceId: () => CLOCK_FENCE,
  });
}

const RESOLVING_ORDER_OUTCOMES = new Set([
  'accepted',
  'accepted_partial_terminal',
  'accepted_reconciled',
  'accepted_operator_verified',
  'not_sent',
  'not_sent_rejected',
  'not_sent_reconciled',
  'not_sent_operator_verified',
]);

/**
 * The production adapter's exact sole-Ledger port over the repository's
 * bounded in-memory CAS implementation. The mutation-authority readback scans
 * the same append-only request/response evidence as the production Ledger,
 * while fills remain identity-unique for the lifetime of this test owner.
 */
class M0InMemoryLedger {
  constructor(clock = testClock()) {
    this.memory = new BoundedInMemoryLedger(clock);
    this.fills = new Map();
  }

  getConfigValue(key) {
    return this.memory.getConfigValue(key);
  }

  compareAndSetConfigValueAndLogEvents(...args) {
    return this.memory.compareAndSetConfigValueAndLogEvents(...args);
  }

  insertFill(input) {
    const key = `${input.symbol}:${input.tradeId}`;
    const prior = this.fills.get(key);
    if (prior !== undefined) {
      if (JSON.stringify(prior) !== JSON.stringify(input)) {
        throw new Error('FILL_IDENTITY_CONFLICT');
      }
      return false;
    }
    this.fills.set(key, Object.freeze({ ...input }));
    return true;
  }

  readDurableMutationAuthority() {
    const events = this.memory.eventsSnapshot();
    const requests = events.filter((event) => event.kind === 'order_request');
    let malformedOrderCount = 0;
    let unresolvedOrderCount = 0;
    for (const request of requests) {
      const data = request.data;
      const valid = data !== null
        && typeof data === 'object'
        && typeof data.reservationId === 'string'
        && /^[0-9a-f-]{16,64}$/iu.test(data.reservationId)
        && data.params !== null
        && typeof data.params === 'object'
        && typeof data.params.newClientOrderId === 'string'
        && /^[A-Za-z0-9_-]{1,36}$/u.test(data.params.newClientOrderId)
        && typeof data.reservedNotionalUsd === 'number'
        && Number.isFinite(data.reservedNotionalUsd)
        && data.reservedNotionalUsd > 0;
      if (!valid) {
        malformedOrderCount += 1;
        continue;
      }
      const resolved = events.some((response) =>
        response.id > request.id
        && response.kind === 'order_response'
        && response.data !== null
        && typeof response.data === 'object'
        && response.data.reservationId === data.reservationId
        && RESOLVING_ORDER_OUTCOMES.has(response.data.outcome),
      );
      if (!resolved) unresolvedOrderCount += 1;
    }
    const ambiguous = malformedOrderCount + unresolvedOrderCount > 0;
    return Object.freeze({
      posture: ambiguous ? 'AMBIGUOUS' : 'PROVEN_ABSENT',
      unresolvedOrderCount,
      unresolvedLoanCount: 0,
      unresolvedTotalCount: unresolvedOrderCount,
      malformedOrderRowCount: malformedOrderCount,
      malformedLoanRowCount: 0,
      malformedTotalCount: malformedOrderCount,
      readErrorCount: 0,
    });
  }

  countEvents(kind, symbol) {
    return this.memory.countEvents(kind, symbol);
  }

  eventsSnapshot() {
    return this.memory.eventsSnapshot();
  }

  close() {
    this.memory.close();
  }
}

function entryTicket(suffix = 'primary') {
  return createSpotExecutionTicket({
    correlationId: `m0-correlation-${suffix}`,
    planId: `m0-plan-${suffix}`,
    accountId: 'account-4',
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'FOK',
    quantity: '0.001',
    price: '10000',
    riskReferencePrice: '10000',
    estimatedMaxLossQuote: '0.25',
    purpose: 'ENTRY',
    attempt: 0,
    createdAtMs: T0 - 2_000,
    expiresAtMs: T0 + 120_000,
  });
}

function flattenTicket(entry, suffix = 'primary') {
  return createSpotExecutionTicket({
    correlationId: entry.correlationId,
    planId: entry.planId,
    accountId: entry.accountId,
    symbol: entry.symbol,
    side: 'SELL',
    type: 'LIMIT',
    timeInForce: 'FOK',
    quantity: '0.001',
    price: '9990',
    riskReferencePrice: '9990',
    estimatedMaxLossQuote: '0.25',
    purpose: 'FLATTEN',
    attempt: suffix === 'primary' ? 1 : 2,
    createdAtMs: T0 - 1_000,
    expiresAtMs: T0 + 120_000,
  });
}

function lifecycleCard(ticket) {
  const cardId = deriveM0SpotLifecycleCardId({
    ownerId: 'owner-account-4',
    accountId: ticket.accountId,
    entryTicketId: ticket.ticketId,
    signedTestEvidenceRevision: 'signed-test-evidence-v1',
    controlRevision: 'control-revision-v1',
  });
  const withoutDigest = Object.freeze({
    schema: M0_SPOT_LIFECYCLE_CARD_SCHEMA,
    version: 1,
    cardId,
    verification: 'VERIFIED_BY_CANONICAL_OWNER_CARD',
    ownerId: 'owner-account-4',
    accountId: ticket.accountId,
    symbol: ticket.symbol,
    baseAsset: 'BTC',
    side: 'BUY',
    orderType: 'LIMIT',
    quoteAsset: 'USDT',
    entryTicketId: ticket.ticketId,
    entryTermsDigest: ticket.termsDigest,
    entryClientOrderId: ticket.clientOrderId,
    entryNotionalQuote: ticket.orderNotionalQuote,
    maximumOrderNotionalQuote: '10',
    maximumSimultaneousExposureQuote: ticket.orderNotionalQuote,
    maximumGrossLifecycleTurnoverQuote: '20',
    maximumResidualDustNotionalQuote: '0.01',
    maximumLossQuote: ticket.estimatedMaxLossQuote,
    maximumExposureDurationMs: 60_000,
    maximumSignedTestSubmissions: 1,
    maximumEntrySubmissions: 1,
    maximumEntryCancelSubmissions: 1,
    maximumFlattenSubmissions: 3,
    maximumFlattenCancelSubmissions: 3,
    recoveryAuthorizedUntil: 'EXACT_FLAT_RECONCILED',
    filterSnapshotRevision: 'filters-v1',
    feeEvidenceRevision: 'fees-v1',
    privateReadRevision: 'private-read-v1',
    signedTestEvidenceRevision: 'signed-test-evidence-v1',
    controlRevision: 'control-revision-v1',
    clockFenceId: CLOCK_FENCE,
    issuedAtMs: T0 - 1_000,
    expiresAtMs: T0 + 59_000,
    issuedMonotonicMs: MONOTONIC_T0 - 1_000,
    expiresMonotonicMs: MONOTONIC_T0 + 59_000,
    oneLifecycle: true,
    actionAllowlist: M0_SPOT_ACTION_ALLOWLIST,
    withdrawalsEnabled: false,
    transfersEnabled: false,
    futuresEnabled: false,
    marginBorrowEnabled: false,
  });
  return Object.freeze({
    ...withoutDigest,
    cardDigest: calculateM0SpotLifecycleCardDigest(withoutDigest),
  });
}

function entryIntent(ticket) {
  return Object.freeze({
    kind: 'SUBMIT_LIVE_ORDER',
    ticketId: ticket.ticketId,
    termsDigest: ticket.termsDigest,
    clientOrderId: ticket.clientOrderId,
    symbol: ticket.symbol,
    side: ticket.side,
    type: ticket.type,
    timeInForce: ticket.timeInForce,
    quantity: ticket.quantity,
    price: ticket.price,
    ownerAuthorizationId: 'owner-authorization-v1',
    signedTestEvidenceId: 'signed-test-evidence-v1',
    filterSnapshotRevision: 'filters-v1',
    singleUse: true,
    automaticRetry: false,
  });
}

function flattenIntent(entry, flatten) {
  return Object.freeze({
    kind: 'FLATTEN',
    sourceTicketId: entry.ticketId,
    flattenTicket: flatten,
    residualQuantity: flatten.quantity,
    automaticRetry: false,
  });
}

function authority(
  state,
  action,
  ticket,
  intent,
  timing = { nowMs: T0, monotonicMs: MONOTONIC_T0 },
) {
  const intentDigest = calculateM0SpotIntentDigest(intent);
  const authorizationId = deriveM0SpotActionAuthorizationId({
    lifecycleId: state.lifecycleId,
    action,
    ticketId: ticket.ticketId,
    intentDigest,
    stateRevision: state.revision,
  });
  return Object.freeze({
    schema: M0_SPOT_ACTION_AUTHORITY_SCHEMA,
    version: 1,
    authorizationId,
    verification: 'VERIFIED_BY_CANONICAL_LIFECYCLE_OWNER',
    lifecycleId: state.lifecycleId,
    cardId: state.card.cardId,
    cardDigest: state.card.cardDigest,
    action,
    ticketId: ticket.ticketId,
    termsDigest: ticket.termsDigest,
    clientOrderId: ticket.clientOrderId,
    intentDigest,
    stateRevision: state.revision,
    clockFenceId: CLOCK_FENCE,
    issuedAtMs: timing.nowMs - 1,
    expiresAtMs: timing.nowMs + 1_000,
    issuedMonotonicMs: timing.monotonicMs - 1,
    expiresMonotonicMs: timing.monotonicMs + 1_000,
    singleUse: true,
  });
}

function dispatchRequest(operation, ticket) {
  const flatten = operation === 'FLATTEN';
  return Object.freeze({
    schema: BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
    operation,
    credentialProfile: 'SPOT_TRADE_EXECUTION',
    contractId: 'SPOT_ORDER_POST',
    method: 'POST',
    path: '/api/v3/order',
    parameters: Object.freeze([
      Object.freeze(['symbol', ticket.symbol]),
      Object.freeze(['side', ticket.side]),
      Object.freeze(['type', ticket.type]),
      Object.freeze(['quantity', ticket.quantity]),
      Object.freeze(['newClientOrderId', ticket.clientOrderId]),
      Object.freeze(['newOrderRespType', 'RESULT']),
      Object.freeze(['timeInForce', ticket.timeInForce]),
      Object.freeze(['price', ticket.price]),
    ]),
    automaticRetry: false,
    transportCallsAuthorized: 1,
    externalActionAuthorization: 'DURABLE_DISPATCH_PERMIT_REQUIRED',
    ...(flatten ? {} : {}),
  });
}

function queryDispatchRequest(ticket) {
  return Object.freeze({
    schema: BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
    operation: 'QUERY_ORDER',
    credentialProfile: 'USER_DATA_READ',
    contractId: 'SPOT_ORDER_QUERY',
    method: 'GET',
    path: '/api/v3/order',
    parameters: Object.freeze([
      Object.freeze(['symbol', ticket.symbol]),
      Object.freeze(['origClientOrderId', ticket.clientOrderId]),
    ]),
    automaticRetry: false,
    transportCallsAuthorized: 1,
    externalActionAuthorization: 'DURABLE_DISPATCH_PERMIT_REQUIRED',
  });
}

function fillsDispatchRequest(ticket, venueOrderId) {
  return Object.freeze({
    schema: BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
    operation: 'QUERY_FILLS',
    credentialProfile: 'USER_DATA_READ',
    contractId: 'SPOT_MY_TRADES_QUERY',
    method: 'GET',
    path: '/api/v3/myTrades',
    parameters: Object.freeze([
      Object.freeze(['symbol', ticket.symbol]),
      Object.freeze(['orderId', venueOrderId]),
    ]),
    automaticRetry: false,
    transportCallsAuthorized: 1,
    externalActionAuthorization: 'DURABLE_DISPATCH_PERMIT_REQUIRED',
  });
}

function cancelDispatchRequest(ticket) {
  return Object.freeze({
    schema: BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
    operation: 'CANCEL',
    credentialProfile: 'SPOT_TRADE_EXECUTION',
    contractId: 'SPOT_ORDER_CANCEL',
    method: 'DELETE',
    path: '/api/v3/order',
    parameters: Object.freeze([
      Object.freeze(['symbol', ticket.symbol]),
      Object.freeze(['origClientOrderId', ticket.clientOrderId]),
    ]),
    automaticRetry: false,
    transportCallsAuthorized: 1,
    externalActionAuthorization: 'DURABLE_DISPATCH_PERMIT_REQUIRED',
  });
}

function withDispatchParameter(request, name, value) {
  return Object.freeze({
    ...request,
    parameters: Object.freeze(request.parameters.map((pair) =>
      Object.freeze([
        pair[0],
        pair[0] === name ? value : pair[1],
      ]))),
  });
}

async function confirmResponse(store, permit) {
  const spend = await store.spend(Object.freeze({
    schema: 'cosmos.system-integration.binance-spot-egress-spend.v1',
    version: 1,
    lifecycleId: permit.lifecycleId,
    authorizationId: permit.receipt.authorizationId,
    permitDigest: permit.permitDigest,
    requestDigest: permit.requestDigest,
    executionRequestId: permit.executionLease.requestId,
    clockFenceId: permit.executionLease.clockFenceId,
    dispatchDeadlineAtMs: permit.dispatchDeadlineAtMs,
    dispatchDeadlineMonotonicMs:
      permit.dispatchDeadlineMonotonicMs,
  }));
  assert.ok(spend);
  assert.equal(await store.confirm(Object.freeze({
    spend,
    outcome: 'RESPONSE_RECEIVED',
  })), true);
  return permit.receipt.authorizationId;
}

async function claimOrderQuery(store, ticket, clock = testClock()) {
  const intent = Object.freeze({
    kind: 'QUERY_BY_ORIGINAL_CLIENT_ORDER_ID',
    ticketId: ticket.ticketId,
    symbol: ticket.symbol,
    originalClientOrderId: ticket.clientOrderId,
    readOnly: true,
  });
  const queryAuthority = authority(
    store.read(),
    'QUERY_ORDER',
    ticket,
    intent,
    {
      nowMs: clock.nowMs(),
      monotonicMs: clock.monotonicMs(),
    },
  );
  const reserved = store.reserveAction({
    action: 'QUERY_ORDER',
    authority: queryAuthority,
    ticket,
    intent,
  });
  assert.equal(reserved.disposition, 'COMMITTED_NEW');
  const claimed = await store.claimDispatch(Object.freeze({
    operation: 'QUERY_ORDER',
    action: 'QUERY_ORDER',
    request: queryDispatchRequest(ticket),
    intent,
  }));
  assert.ok(claimed);
  await confirmResponse(store, claimed);
  return claimed;
}

async function claimFillsQuery(
  store,
  ticket,
  venueOrderId,
  clock = testClock(),
) {
  const intent = Object.freeze({
    kind: 'QUERY_FILLS',
    ticketId: ticket.ticketId,
    symbol: ticket.symbol,
    originalClientOrderId: ticket.clientOrderId,
    venueOrderId,
    readOnly: true,
  });
  const queryAuthority = authority(
    store.read(),
    'QUERY_FILLS',
    ticket,
    intent,
    {
      nowMs: clock.nowMs(),
      monotonicMs: clock.monotonicMs(),
    },
  );
  assert.equal(store.reserveAction({
    action: 'QUERY_FILLS',
    authority: queryAuthority,
    ticket,
    intent,
  }).disposition, 'COMMITTED_NEW');
  const claimed = await store.claimDispatch(Object.freeze({
    operation: 'QUERY_FILLS',
    action: 'QUERY_FILLS',
    request: fillsDispatchRequest(ticket, venueOrderId),
    intent,
  }));
  assert.ok(claimed);
  await confirmResponse(store, claimed);
  return claimed;
}

function persistence(ledger, clock = testClock()) {
  return new M0SpotLifecyclePersistenceAdapter({
    ledger,
    clock,
    resolveAction: Object.freeze({ resolve: () => null }),
  });
}

function mutableClock() {
  let nowMs = T0;
  let monotonicMs = MONOTONIC_T0;
  return Object.freeze({
    nowMs: () => nowMs,
    monotonicMs: () => monotonicMs,
    clockFenceId: () => CLOCK_FENCE,
    advance: ({ wallMs = 0, monotonicElapsedMs = 0 } = {}) => {
      nowMs += wallMs;
      monotonicMs += monotonicElapsedMs;
    },
  });
}

function executionInput(hex, digestHex) {
  return Object.freeze({
    requestId: `m0_req_${hex}`,
    idempotencyKeyDigest: `sha256:${digestHex}`,
    operatorId: 'owner-account-4',
    executorId: 'm0-account-4-executor',
    hostId: 'runtime-host',
    bootId: 'boot-0000000000000001',
    processId: 'pid-4004',
    revision: '0123456789abcdef0123456789abcdef01234567',
    mode: 'ENTRY',
  });
}

function runtimeReadinessCard(card, ticket) {
  const observedAtMs = T0 - 2_100;
  const validUntilMs = T0 + 2_800;
  const source = projectM0SpotSourceReadinessCard(observedAtMs);
  const { readinessDigest: _discarded, ...sourceWithoutDigest } = source;
  const withoutDigest = Object.freeze({
    ...sourceWithoutDigest,
    lifecycleCardDigest: card.cardDigest,
    executableEntryEvidenceDigest:
      `sha256:${ticket.termsDigest}${ticket.termsDigest}`,
    disposition: 'READY_FOR_OWNER_GATE_2',
    gate2Ready: true,
    evidenceAuthority: 'RUNTIME_PRIVATE',
    ownerId: card.ownerId,
    validUntilMs,
    revisionHost: Object.freeze({
      state: 'VERIFIED_CURRENT',
      revision: '0123456789abcdef0123456789abcdef01234567',
      hostId: 'runtime-host',
      bootId: 'boot-0000000000000001',
      processId: 'pid-4004',
    }),
    accountMode: Object.freeze({
      state: 'VERIFIED_CURRENT',
      accountId: card.accountId,
      accountType: 'SPOT',
      privateReadVerified: true,
      balancesRead: true,
      ordersRead: true,
      fillsRead: true,
      permissionRead: true,
    }),
    accountCanTrade: Object.freeze({
      state: 'VERIFIED_CURRENT',
      profileId: 'm0-read-profile',
      accountRealmId: card.accountId,
      accountFingerprintRef: 'm0-account-fingerprint',
      permissionRevision: 'read-permissions-v1',
      value: true,
      observedAtMs,
      validUntilMs,
      evidenceRevision: 'account-can-trade-v1',
      minimumPermissionTransition: null,
    }),
    apiKeyPermissions: Object.freeze({
      state: 'VERIFIED_CURRENT',
      accountRealmId: card.accountId,
      accountFingerprintRef: 'm0-account-fingerprint',
      evidenceDigest: `sha256:${'a'.repeat(64)}`,
      readProfile: Object.freeze({
        profileId: 'm0-read-profile',
        permissionRevision: 'read-permissions-v1',
        signerFingerprint: `sha256:${'b'.repeat(64)}`,
        signerRevision: 'read-signer-v1',
        observedAtMs,
        validUntilMs,
      }),
      executionProfile: Object.freeze({
        profileId: 'm0-execution-profile',
        permissionRevision: 'execution-permissions-v1',
        signerFingerprint: `sha256:${'c'.repeat(64)}`,
        signerRevision: 'execution-signer-v1',
        observedAtMs,
        validUntilMs,
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
      observedAtMs,
      validUntilMs,
      evidenceRevision: 'api-key-permissions-v1',
    }),
    appExecutionArmed: Object.freeze({
      state: 'VERIFIED_CURRENT',
      current: false,
      proposed: 'ARM_EXACT_CARD_AFTER_OWNER_YES',
    }),
    venueRoutes: Object.freeze({
      ...source.venueRoutes,
      compositionState: 'VERIFIED_CURRENT',
    }),
    excludedCapabilities: Object.freeze({
      ...source.excludedCapabilities,
      state: 'VERIFIED_CURRENT',
    }),
    namedExecutor: Object.freeze({
      state: 'VERIFIED_CURRENT',
      executorId: 'm0-account-4-executor',
      hostId: 'runtime-host',
      bootId: 'boot-0000000000000001',
      processId: 'pid-4004',
      authority: 'EXACT_CARD_ONE_LIFECYCLE',
    }),
    order: Object.freeze({
      ...source.order,
      state: 'VERIFIED_CURRENT',
      symbol: card.symbol,
      baseAsset: card.baseAsset,
      allowlist: Object.freeze([card.symbol]),
      price: ticket.price,
      quoteAmount: card.entryNotionalQuote,
      baseQuantity: ticket.quantity,
    }),
    limits: Object.freeze({
      ...source.limits,
      maximumSimultaneousExposureQuote: card.maximumSimultaneousExposureQuote,
      maximumGrossLifecycleTurnoverQuote:
        card.maximumGrossLifecycleTurnoverQuote,
      maximumLossQuote: card.maximumLossQuote,
      maximumExposureDurationMs: card.maximumExposureDurationMs,
    }),
    filters: Object.freeze({
      state: 'VERIFIED_CURRENT',
      symbolStatus: 'TRADING',
      baseAsset: card.baseAsset,
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
      completeSnapshotDigest: `sha256:${'d'.repeat(64)}`,
      observedAtMs,
      validUntilMs,
      snapshotRevision: card.filterSnapshotRevision,
    }),
    liquidity: Object.freeze({
      state: 'VERIFIED_CURRENT',
      symbol: card.symbol,
      classification: 'LIQUID',
      observedSpreadBps: '1',
      maximumSpreadBps: '5',
      observedDepthQuote: '100',
      minimumDepthQuote: card.maximumGrossLifecycleTurnoverQuote,
      evidenceDigest: `sha256:${'e'.repeat(64)}`,
      observedAtMs,
      validUntilMs,
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
      observedAtMs,
      validUntilMs,
      evidenceRevision: card.feeEvidenceRevision,
    }),
    baseline: Object.freeze({
      state: 'VERIFIED_CURRENT',
      baseAsset: card.baseAsset,
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
      observedAtMs,
      validUntilMs,
      baselineRevision: card.privateReadRevision,
    }),
    clientIdentity: Object.freeze({
      ...source.clientIdentity,
      state: 'VERIFIED_CURRENT',
      ticketId: ticket.ticketId,
      entryClientOrderId: ticket.clientOrderId,
      termsDigest: ticket.termsDigest,
    }),
    validation: Object.freeze({
      state: 'VERIFIED_CURRENT',
      signedTestPassed: true,
      observedAtMs,
      validUntilMs,
      evidenceRevision: card.signedTestEvidenceRevision,
    }),
    recovery: Object.freeze({
      ...source.recovery,
      state: 'VERIFIED_CURRENT',
      baselineRevision: card.privateReadRevision,
      exchangeBaseTolerance: '0.00000001',
      quoteQuantityTolerance: '0.01',
      maximumResidualDustNotionalQuote:
        card.maximumResidualDustNotionalQuote,
      feeReserveQuote: '0.02',
      maximumRecoveryDurationMs: card.maximumExposureDurationMs,
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
      ownerId: card.ownerId,
      procedure:
        'runtime-config:m0-spot-execution=DISARMED;kill-switch=ENGAGED',
      configRevision: card.controlRevision,
      evidenceRevision: 'rollback-v1',
      reversesMarketExposure: false,
    }),
    residualCondition: 'EXACT_ZERO_DELTA_BASELINE_VERIFIED',
    exactLimitation: null,
    ownerAction: 'YES',
  });
  return Object.freeze({
    ...withoutDigest,
    readinessDigest: calculateM0SpotReadinessDigest(withoutDigest),
  });
}

function exactFlatEvidence(state, overrides = {}) {
  const attempts = [
    ...state.flattenHistory,
    ...(state.flatten === null ? [] : [state.flatten]),
  ];
  const latestFlatten = attempts.at(-1) ?? null;
  const baseAsset = state.card.baseAsset;
  const sourceBaseCommissionQuantity = state.fills
    .filter((fill) =>
      fill.leg === 'ENTRY' && fill.commissionAsset === baseAsset)
    .reduce((sum, fill) => addSpotDecimals(sum, fill.commission), '0');
  const flattenBaseCommissionQuantity = state.fills
    .filter((fill) =>
      fill.leg === 'FLATTEN' && fill.commissionAsset === baseAsset)
    .reduce((sum, fill) => addSpotDecimals(sum, fill.commission), '0');
  const observation = (fill) => Object.freeze({
    fillId: fill.fillId,
    venueOrderId: fill.venueOrderId,
    price: fill.price,
    quantity: fill.quantity,
    quoteQuantity: fill.quoteQuantity,
    commission: fill.commission,
    commissionAsset: fill.commissionAsset,
    occurredAtMs: fill.occurredAtMs,
  });
  const sourceFills = Object.freeze(
    state.fills.filter((fill) => fill.leg === 'ENTRY').map(observation),
  );
  const quoteAttempts = Object.freeze(attempts.map((attempt, index) =>
    Object.freeze({
      attempt: index + 1,
      ticket: attempt.ticket,
      venueOrderId: attempt.venueOrderId,
      authoritativelyAbsent:
        attempt.venueStatus === 'AUTHORITATIVE_NOT_FOUND',
      terminal: true,
      fillsComplete: true,
      fills: Object.freeze(state.fills
        .filter((fill) =>
          fill.leg === 'FLATTEN'
          && attempt.venueOrderId !== null
          && fill.venueOrderId === attempt.venueOrderId)
        .map(observation)),
    })));
  const quoteAccounting = deriveSpotQuoteAccounting({
    sourceTicket: state.entryTicket,
    sourceVenueOrderId: state.entry?.venueOrderId ?? null,
    sourceFills,
    flattenAttempts: quoteAttempts,
    baseAsset,
    quoteAsset: 'USDT',
  });
  const baselineQuoteQuantity =
    state.readinessCard.baseline.baselineQuoteQuantity;
  const observedQuoteQuantity =
    quoteAccounting.fillDerivedQuoteCashflow.direction === 'CREDIT'
      ? addSpotDecimals(
          baselineQuoteQuantity,
          quoteAccounting.fillDerivedQuoteCashflow.quantity,
        )
      : quoteAccounting.fillDerivedQuoteCashflow.direction === 'DEBIT'
        ? subtractSpotDecimals(
            baselineQuoteQuantity,
            quoteAccounting.fillDerivedQuoteCashflow.quantity,
          )
        : baselineQuoteQuantity;
  const baselineBaseQuantity =
    state.readinessCard.baseline.baselineBaseQuantity;
  const residualDustNotionalQuote = multiplySpotDecimals(
    state.residualQuantity,
    state.entryTicket.riskReferencePrice,
  );
  const sourceOrderAuthoritativelyAbsent =
    state.entry?.venueStatus === 'AUTHORITATIVE_NOT_FOUND';
  return Object.freeze({
    revision: 'm0-flat-reconciliation-v1',
    sourceTicketId: state.entryTicket.ticketId,
    sourceClientOrderId: state.entryTicket.clientOrderId,
    sourceVenueOrderId: state.entry?.venueOrderId ?? null,
    sourceOrderAuthoritativelyAbsent,
    sourceOpenOrderAbsent: true,
    sourceOrderTerminal: state.entry?.terminal ?? false,
    sourceFillsComplete: state.entry?.fillsComplete ?? false,
    sourceCumulativeFilledQuantity:
      state.entry?.cumulativeFilledQuantity ?? '0',
    flattenTicketId: latestFlatten?.ticket.ticketId ?? null,
    flattenClientOrderId: latestFlatten?.ticket.clientOrderId ?? null,
    flattenVenueOrderId: latestFlatten?.venueOrderId ?? null,
    flattenOrderTerminal: latestFlatten?.terminal ?? true,
    flattenFillsComplete: latestFlatten?.fillsComplete ?? true,
    flattenCumulativeFilledQuantity: attempts.reduce(
      (sum, attempt) => addSpotDecimals(
        sum,
        attempt.cumulativeFilledQuantity,
      ),
      '0',
    ),
    baseAsset,
    baselineRevision: state.readinessCard.baseline.baselineRevision,
    baselineBaseQuantity,
    observedBaseQuantity:
      addSpotDecimals(baselineBaseQuantity, state.residualQuantity),
    exchangeBaseTolerance:
      state.readinessCard.baseline.exchangeBaseTolerance,
    maximumResidualDustNotionalQuote:
      state.readinessCard.limits.maximumResidualDustNotionalQuote,
    residualDustNotionalQuote,
    sourceBaseCommissionQuantity,
    flattenBaseCommissionQuantity,
    canaryAttributableBaseDeltaQuantity: state.residualQuantity,
    flattenAttemptCount: attempts.length,
    allFlattenOrdersTerminal: attempts.every((attempt) => attempt.terminal),
    allFlattenFillsComplete:
      attempts.every((attempt) => attempt.fillsComplete),
    flattenOpenOrdersAbsent: true,
    authoritativelyAbsentFlattenClientOrderIds: Object.freeze(
      attempts
        .filter((attempt) =>
          attempt.venueStatus === 'AUTHORITATIVE_NOT_FOUND')
        .map((attempt) => attempt.ticket.clientOrderId),
    ),
    canonicalStatus: 'EXACT',
    ledgerState: 'MATCHED',
    quoteAsset: 'USDT',
    baselineQuoteQuantity,
    observedQuoteQuantity,
    quoteQuantityTolerance:
      state.readinessCard.baseline.quoteQuantityTolerance,
    observedQuoteDelta: quoteAccounting.fillDerivedQuoteCashflow,
    sourceGrossQuoteDebit: quoteAccounting.sourceGrossQuoteDebit,
    flattenGrossQuoteCredit: quoteAccounting.flattenGrossQuoteCredit,
    observedGrossLifecycleTurnoverQuote:
      quoteAccounting.observedGrossLifecycleTurnoverQuote,
    authorizedFilledLifecycleTurnoverQuote:
      quoteAccounting.authorizedFilledLifecycleTurnoverQuote,
    favorableSellPriceImprovementQuote:
      quoteAccounting.favorableSellPriceImprovementQuote,
    referencePnlQuote: quoteAccounting.referencePnlQuote,
    signedSlippageCostQuote: quoteAccounting.signedSlippageCostQuote,
    quoteCommissionDebit: quoteAccounting.quoteCommissionDebit,
    fillDerivedQuoteCashflow: quoteAccounting.fillDerivedQuoteCashflow,
    realizedPnlAfterQuoteFees:
      quoteAccounting.realizedPnlAfterQuoteFees,
    quoteEquationResidual: Object.freeze({
      direction: 'ZERO',
      quantity: '0',
    }),
    commissionTotals: quoteAccounting.commissionTotals,
    quoteCashflowStatus: 'EXACT_WITHIN_TOLERANCE',
    quoteEconomicsStatus: quoteAccounting.quoteEconomicsStatus,
    thirdAssetCommissionQuoteValueStatus:
      quoteAccounting.thirdAssetCommissionQuoteValueStatus,
    thirdAssetCommissionQuoteValue: null,
    thirdAssetValuationDigest: null,
    occurredAtMs: T0,
    ...overrides,
  });
}

test('arm rejects a readiness dust ceiling that differs from the card with zero durable writes', () => {
  const ledger = new M0InMemoryLedger();
  try {
    const store = persistence(ledger);
    const entry = entryTicket('dust-binding-mismatch');
    const card = lifecycleCard(entry);
    const valid = runtimeReadinessCard(card, entry);
    const {
      readinessDigest: _readinessDigest,
      ...withoutDigest
    } = valid;
    const mismatchedWithoutDigest = Object.freeze({
      ...withoutDigest,
      limits: Object.freeze({
        ...withoutDigest.limits,
        maximumResidualDustNotionalQuote: '0.02',
      }),
      recovery: Object.freeze({
        ...withoutDigest.recovery,
        maximumResidualDustNotionalQuote: '0.02',
      }),
    });
    const mismatched = Object.freeze({
      ...mismatchedWithoutDigest,
      readinessDigest:
        calculateM0SpotReadinessDigest(mismatchedWithoutDigest),
    });
    const rejected = store.armLifecycle(card, entry, mismatched);
    assert.equal(rejected.disposition, 'BLOCKED');
    assert.equal(rejected.code, 'M0_READINESS_CARD_BINDING_INVALID');
    assert.equal(store.read(), null);
    assert.deepEqual(ledger.eventsSnapshot(), []);
  } finally {
    ledger.close();
  }
});

test('two transport instances share one durable egress spend and exactly one may fetch', async () => {
  const clock = mutableClock();
  const ledger = new M0InMemoryLedger(clock);
  try {
    const owner = persistence(ledger, clock);
    const contender = persistence(ledger, clock);
    const entry = entryTicket('durable-egress-spend');
    const card = lifecycleCard(entry);
    assert.equal(
      owner.armLifecycle(
        card,
        entry,
        runtimeReadinessCard(card, entry),
      ).disposition,
      'COMMITTED_NEW',
    );
    assert.equal(
      owner.acquireExecution(
        executionInput('99999999999999999999999999999999', '9'.repeat(64)),
      ).disposition,
      'ACQUIRED',
    );
    const intent = entryIntent(entry);
    const entryAuthority = authority(owner.read(), 'ENTRY', entry, intent);
    assert.equal(owner.reserveAction({
      action: 'ENTRY',
      authority: entryAuthority,
      ticket: entry,
      intent,
    }).disposition, 'COMMITTED_NEW');
    const request = dispatchRequest('SUBMIT', entry);
    const permit = await owner.claimDispatch(Object.freeze({
      operation: 'SUBMIT',
      action: 'ENTRY',
      request,
      intent,
    }));
    assert.ok(permit);
    const spendRequest = Object.freeze({
      schema: 'cosmos.system-integration.binance-spot-egress-spend.v1',
      version: 1,
      lifecycleId: permit.lifecycleId,
      authorizationId: permit.receipt.authorizationId,
      permitDigest: permit.permitDigest,
      requestDigest: permit.requestDigest,
      executionRequestId: permit.executionLease.requestId,
      clockFenceId: permit.executionLease.clockFenceId,
      dispatchDeadlineAtMs: permit.dispatchDeadlineAtMs,
      dispatchDeadlineMonotonicMs:
        permit.dispatchDeadlineMonotonicMs,
    });
    for (const substitution of [
      { permitDigest: `sha256:${'e'.repeat(64)}` },
      { requestDigest: `sha256:${'f'.repeat(64)}` },
      { executionRequestId: `m0_req_${'8'.repeat(32)}` },
      { clockFenceId: 'm0_clock_fence_substituted-000000000001' },
      { dispatchDeadlineAtMs: permit.dispatchDeadlineAtMs + 1 },
      {
        dispatchDeadlineMonotonicMs:
          permit.dispatchDeadlineMonotonicMs + 1,
      },
    ]) {
      assert.equal(
        await contender.spend(Object.freeze({
          ...spendRequest,
          ...substitution,
        })),
        null,
        'every egress spend field is exact-bound before fetch',
      );
    }
    assert.equal(
      owner.read().actions.find((action) =>
        action.receipt.authorizationId === permit.receipt.authorizationId)
        .egressSpentAtMs,
      null,
    );

    let fetchCalls = 0;
    let signatures = 0;
    const signer = (apiKey) => Object.freeze({
      algorithm: 'HMAC_SHA256',
      apiKey,
      async sign() {
        signatures += 1;
        return 'd'.repeat(64);
      },
    });
    const transport = (egress) => createM0SpotProductionTransport({
      allowedSymbol: entry.symbol,
      allowedCardDigest: card.cardDigest,
      recvWindowMs: 5_000,
      requestTimeoutMs: 5_000,
      clock,
      readSigner: signer('m0-read-key-0123456789abcdef'),
      executionSigner: signer('m0-exec-key-0123456789abcdef'),
      egress,
      fetch: async () => {
        fetchCalls += 1;
        return new Response('{}', { status: 200 });
      },
    });
    const firstTransport = transport(owner);
    const secondTransport = transport(contender);
    const outcomes = await Promise.allSettled([
      firstTransport.send(request, permit),
      secondTransport.send(request, permit),
    ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      outcomes.filter((outcome) => outcome.status === 'rejected').length,
      1,
    );
    assert.equal(signatures, 2, 'both process-local transports may sign');
    assert.equal(fetchCalls, 1, 'the sole durable CAS spend gates fetch');
    const persisted = owner.read().actions.find((action) =>
      action.receipt.authorizationId === permit.receipt.authorizationId);
    assert.equal(persisted.egressSpentAtMs, clock.nowMs());
    assert.equal(persisted.egressSpentMonotonicMs, clock.monotonicMs());
    assert.equal(persisted.egressConfirmation, 'RESPONSE_RECEIVED');
    assert.equal(
      ledger.countEvents('system_integration.m0_spot.egress_spent'),
      1,
    );
    assert.equal(
      ledger.countEvents('system_integration.m0_spot.egress_confirmed'),
      1,
    );
  } finally {
    ledger.close();
  }
});

test('sole Ledger atomically locks one lifecycle, consumes one-use dispatch, survives restart, records fills, and disarms only after exact flat proof', async () => {
  const clock = mutableClock();
  const ledger = new M0InMemoryLedger(clock);
  try {
    let store = persistence(ledger, clock);
    const entry = entryTicket();
    const card = lifecycleCard(entry);
    assert.equal(card.cardDigest.startsWith('sha256:'), true);
    assert.equal(deriveM0SpotLifecycleId(card.cardDigest).startsWith('m0_lifecycle_'), true);

    const armed = store.armLifecycle(card, entry, runtimeReadinessCard(card, entry));
    assert.equal(armed.disposition, 'COMMITTED_NEW', armed.code);
    assert.equal(armed.state.lifecycleLock, 'HELD');
    assert.equal(armed.state.newEntryArmed, true);
    assert.equal(store.armLifecycle(
      card, entry, runtimeReadinessCard(card, entry),
    ).disposition, 'REPLAY_QUERY_ONLY');
    const competingEntry = entryTicket('competing');
    assert.equal(
      store.armLifecycle(
        lifecycleCard(competingEntry),
        competingEntry,
        runtimeReadinessCard(lifecycleCard(competingEntry), competingEntry),
      ).disposition,
      'CONFLICT',
      'the sole lifecycle compare-and-set lock rejects a second card',
    );

    const submitIntent = entryIntent(entry);
    const withoutLease = authority(store.read(), 'ENTRY', entry, submitIntent);
    assert.deepEqual(
      store.reserveAction({
        action: 'ENTRY', authority: withoutLease, ticket: entry, intent: submitIntent,
      }),
      {
        disposition: 'BLOCKED',
        code: 'M0_EXECUTION_LEASE_REQUIRED',
        state: store.read(),
      },
      'entry authority is inert until the owner has an active execution lease',
    );
    const lease = executionInput('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '1'.repeat(64));
    assert.equal(store.acquireExecution(lease).disposition, 'ACQUIRED');
    const contender = persistence(ledger).acquireExecution(
      executionInput('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '2'.repeat(64)),
    );
    assert.equal(contender.disposition, 'IN_FLIGHT');
    assert.equal(contender.code, 'M0_EXECUTION_BUSY');
    const idempotentContender = persistence(ledger).acquireExecution(lease);
    assert.equal(idempotentContender.disposition, 'IN_FLIGHT');
    assert.equal(idempotentContender.code, 'M0_EXECUTION_IDEMPOTENT_IN_FLIGHT');

    const entryAuthority = authority(store.read(), 'ENTRY', entry, submitIntent);
    const reserved = store.reserveAction({
      action: 'ENTRY',
      authority: entryAuthority,
      ticket: entry,
      intent: submitIntent,
    });
    assert.equal(reserved.disposition, 'COMMITTED_NEW');
    assert.equal(reserved.receipt.intentDigest, calculateM0SpotIntentDigest(submitIntent));
    assert.equal(reserved.receipt.authorizationReuseAllowed, false);
    assert.equal(reserved.state.newEntryArmed, false);
    assert.equal(ledger.countEvents('order_request', 'BTCUSDT'), 1);
    assert.equal(
      ledger.countEvents('system_integration.m0_spot.action_consumed', 'BTCUSDT'),
      1,
    );
    const reservationEvents = ledger.eventsSnapshot().filter((event) =>
      event.kind === 'system_integration.m0_spot.action_consumed'
      || event.kind === 'order_request',
    );
    assert.equal(reservationEvents.length, 2);
    assert.equal(
      reservationEvents[1].id,
      reservationEvents[0].id + 1,
      'authority consumption and canonical request are one adjacent CAS batch',
    );
    assert.deepEqual(ledger.readDurableMutationAuthority(), {
      posture: 'AMBIGUOUS',
      unresolvedOrderCount: 1,
      unresolvedLoanCount: 0,
      unresolvedTotalCount: 1,
      malformedOrderRowCount: 0,
      malformedLoanRowCount: 0,
      malformedTotalCount: 0,
      readErrorCount: 0,
    });

    const request = dispatchRequest('SUBMIT', entry);
    const claimInput = Object.freeze({
      operation: 'SUBMIT',
      action: 'ENTRY',
      request,
      intent: submitIntent,
    });
    for (const [name, substituted] of [
      ['newClientOrderId', 'miswired-client-order-id'],
      ['quantity', '0.0009'],
      ['price', '9999'],
    ]) {
      assert.equal(await store.claimDispatch(Object.freeze({
        ...claimInput,
        request: withDispatchParameter(request, name, substituted),
      })), null);
    }
    assert.equal(store.read().actions[0].dispatchClaimed, false);
    const permit = await store.claimDispatch(claimInput);
    assert.equal(permit?.receipt.authorizationId, entryAuthority.authorizationId);
    assert.equal(permit?.dispatchCardinality, 'ONE');
    assert.equal(permit?.automaticRetry, false);
    assert.equal(permit?.credentialProfile, 'SPOT_TRADE_EXECUTION');
    assert.equal(permit?.receipt.consumedAtMs, T0);
    assert.equal(permit?.receipt.consumedMonotonicMs, MONOTONIC_T0);
    assert.equal(store.read().actions[0].dispatchClaimedAtMs, T0);
    assert.equal(store.read().actions[0].dispatchClaimedMonotonicMs, MONOTONIC_T0);
    assert.equal(await store.claimDispatch(claimInput), null);
    assert.equal(
      store.reserveAction({
        action: 'ENTRY',
        authority: entryAuthority,
        ticket: entry,
        intent: submitIntent,
      }).disposition,
      'REPLAY_QUERY_ONLY',
    );
    assert.equal(
      store.reserveAction({
        action: 'ENTRY',
        authority: entryAuthority,
        ticket: entry,
        intent: Object.freeze({ ...submitIntent, price: '9999' }),
      }).disposition,
      'CONFLICT',
      'one authorization identity cannot be rebound to another intent digest',
    );

    assert.equal(store.recordMutationOutcome({
      authorizationId: entryAuthority.authorizationId,
      outcome: 'accepted_reconciled',
      detail: 'venue acknowledged and exact entry identity was reconciled',
    }).disposition, 'COMMITTED_NEW');
    assert.equal(ledger.readDurableMutationAuthority().posture, 'PROVEN_ABSENT');

    const entryOrderQuery = await claimOrderQuery(store, entry, clock);
    const overBoundObservation = store.recordOrderObservation({
      leg: 'ENTRY',
      ticketId: entry.ticketId,
      queryAuthorizationId:
        entryOrderQuery.receipt.authorizationId,
      venueOrderId: '70001',
      venueStatus: 'FILLED',
      terminal: true,
      fillsComplete: true,
      cumulativeFilledQuantity: '0.002',
      evidenceRevision: 'entry-order-over-bound-v1',
    });
    assert.equal(overBoundObservation.disposition, 'CONFLICT');
    assert.equal(overBoundObservation.code, 'M0_ORDER_OBSERVATION_CONFLICT');
    assert.equal(store.recordOrderObservation({
      leg: 'ENTRY',
      ticketId: entry.ticketId,
      queryAuthorizationId:
        entryOrderQuery.receipt.authorizationId,
      venueOrderId: '70001',
      venueStatus: 'FILLED',
      terminal: true,
      fillsComplete: false,
      cumulativeFilledQuantity: '0.001',
      evidenceRevision: 'entry-order-v1',
    }).disposition, 'COMMITTED_NEW');
    assert.equal(
      store.recordOrderObservation({
        leg: 'ENTRY',
        ticketId: entry.ticketId,
        queryAuthorizationId:
          entryOrderQuery.receipt.authorizationId,
        venueOrderId: '70001',
        venueStatus: 'FILLED',
        terminal: true,
        fillsComplete: false,
        cumulativeFilledQuantity: '0.001',
        evidenceRevision: 'entry-order-proof-replay-v1',
      }).disposition,
      'BLOCKED',
      'one QUERY_ORDER response proof cannot be reused',
    );
    const terminalRegressionQuery = await claimOrderQuery(
      store,
      entry,
      clock,
    );
    const terminalRegression = store.recordOrderObservation({
      leg: 'ENTRY',
      ticketId: entry.ticketId,
      queryAuthorizationId:
        terminalRegressionQuery.receipt.authorizationId,
      venueOrderId: '70001',
      venueStatus: 'PARTIALLY_FILLED',
      terminal: false,
      fillsComplete: false,
      cumulativeFilledQuantity: '0.001',
      evidenceRevision: 'entry-terminal-regression-v1',
    });
    assert.equal(terminalRegression.disposition, 'CONFLICT');
    assert.equal(
      terminalRegression.code,
      'M0_ORDER_OBSERVATION_CONFLICT',
    );
    const venueIdMismatchQuery = await claimOrderQuery(store, entry, clock);
    const venueIdMismatch = store.recordOrderObservation({
      leg: 'ENTRY',
      ticketId: entry.ticketId,
      queryAuthorizationId:
        venueIdMismatchQuery.receipt.authorizationId,
      venueOrderId: '79999',
      venueStatus: 'FILLED',
      terminal: true,
      fillsComplete: false,
      cumulativeFilledQuantity: '0.001',
      evidenceRevision: 'entry-venue-id-mismatch-v1',
    });
    assert.equal(venueIdMismatch.disposition, 'CONFLICT');
    assert.equal(
      venueIdMismatch.code,
      'M0_ORDER_OBSERVATION_CONFLICT',
    );
    const fillsIntent = Object.freeze({
      kind: 'QUERY_FILLS',
      ticketId: entry.ticketId,
      symbol: entry.symbol,
      originalClientOrderId: entry.clientOrderId,
      venueOrderId: '70001',
      readOnly: true,
    });
    const fillsAuthority = authority(
      store.read(),
      'QUERY_FILLS',
      entry,
      fillsIntent,
    );
    assert.equal(store.reserveAction({
      action: 'QUERY_FILLS',
      authority: fillsAuthority,
      ticket: entry,
      intent: fillsIntent,
    }).disposition, 'COMMITTED_NEW');
    const fillsClaimInput = Object.freeze({
      operation: 'QUERY_FILLS',
      action: 'QUERY_FILLS',
      request: fillsDispatchRequest(entry, '70001'),
      intent: fillsIntent,
    });
    assert.equal(await store.claimDispatch(Object.freeze({
      ...fillsClaimInput,
      request: fillsDispatchRequest(entry, '99999'),
    })), null);
    const entryFillsQuery = await store.claimDispatch(fillsClaimInput);
    assert.ok(entryFillsQuery);
    await confirmResponse(store, entryFillsQuery);
    const entryFill = Object.freeze({
      fillId: '80001',
      venueOrderId: '70001',
      price: '10000',
      quantity: '0.001',
      quoteQuantity: '10',
      commission: '0.001',
      commissionAsset: 'USDT',
      occurredAtMs: T0,
    });
    assert.equal(
      store.recordFill({
        leg: 'ENTRY',
        ticketId: entry.ticketId,
        queryAuthorizationId:
          entryFillsQuery.receipt.authorizationId,
        symbol: 'BTCUSDT',
        fills: Object.freeze([entryFill]),
      }).disposition,
      'COMMITTED_NEW',
    );
    assert.equal(
      store.recordFill({
        leg: 'ENTRY',
        ticketId: entry.ticketId,
        queryAuthorizationId:
          entryFillsQuery.receipt.authorizationId,
        symbol: 'BTCUSDT',
        fills: Object.freeze([entryFill]),
      }).disposition,
      'BLOCKED',
      'one QUERY_FILLS response proof cannot be reused',
    );

    const preFlat = store.reconcileAndDisarm(exactFlatEvidence(store.read()));
    assert.equal(preFlat.disposition, 'BLOCKED');
    assert.equal(preFlat.code, 'M0_EXACT_FLAT_RECONCILIATION_NOT_PROVED');
    assert.equal(preFlat.state.lifecycleLock, 'HELD');

    const staleOrderQuery = await claimOrderQuery(store, entry, clock);
    assert.equal(
      store.parkExecution(lease.requestId).disposition,
      'COMMITTED_NEW',
    );
    const recoveryLease = Object.freeze({
      ...executionInput(
        'cccccccccccccccccccccccccccccccc',
        '3'.repeat(64),
      ),
      bootId: 'boot-0000000000000002',
      processId: 'pid-5005',
      mode: 'RECOVERY_ONLY',
    });
    assert.equal(
      store.acquireExecution(recoveryLease).disposition,
      'ACQUIRED',
    );
    assert.equal(
      store.recordOrderObservation({
        leg: 'ENTRY',
        ticketId: entry.ticketId,
        queryAuthorizationId:
          staleOrderQuery.receipt.authorizationId,
        venueOrderId: '70001',
        venueStatus: 'FILLED',
        terminal: true,
        fillsComplete: true,
        cumulativeFilledQuantity: '0.001',
        evidenceRevision: 'stale-request-id-order-proof-v1',
      }).disposition,
      'BLOCKED',
      'a response proof from the prior execution request ID is inert',
    );

    const restarted = store.markRestartRecovery('process-restart-0001');
    assert.equal(restarted.disposition, 'COMMITTED_NEW');
    assert.equal(restarted.state.phase, 'RECOVERY_REQUIRED');
    assert.equal(restarted.state.newEntryArmed, false);
    const digestBeforeRestart = restarted.state.stateDigest;
    // A new adapter instance simulates process restart while the sole Ledger
    // retains the exact digest-chained config and append-only evidence.
    store = persistence(ledger, clock);
    assert.equal(store.read().stateDigest, digestBeforeRestart);
    assert.equal(store.read().lifecycleLock, 'HELD');
    assert.equal(await store.claimDispatch(claimInput), null);

    const flatten = flattenTicket(entry);
    const recoveryIntent = flattenIntent(entry, flatten);
    const flattenAuthority = authority(
      store.read(),
      'FLATTEN',
      flatten,
      recoveryIntent,
    );
    const flattenReservation = store.reserveAction({
      action: 'FLATTEN',
      authority: flattenAuthority,
      ticket: flatten,
      intent: recoveryIntent,
    });
    assert.equal(flattenReservation.disposition, 'COMMITTED_NEW');
    const flattenClaim = await store.claimDispatch(Object.freeze({
      operation: 'FLATTEN',
      action: 'FLATTEN',
      request: dispatchRequest('FLATTEN', flatten),
      intent: recoveryIntent,
    }));
    assert.equal(
      flattenClaim?.receipt.authorizationId,
      flattenAuthority.authorizationId,
    );
    assert.equal(store.recordMutationOutcome({
      authorizationId: flattenAuthority.authorizationId,
      outcome: 'accepted_reconciled',
      detail: 'venue acknowledged and exact flatten identity was reconciled',
    }).disposition, 'COMMITTED_NEW');
    const collisionFlattenQuery = await claimOrderQuery(
      store,
      flatten,
      clock,
    );
    const venueIdCollision = store.recordOrderObservation({
      leg: 'FLATTEN',
      ticketId: flatten.ticketId,
      queryAuthorizationId:
        collisionFlattenQuery.receipt.authorizationId,
      venueOrderId: '70001',
      venueStatus: 'FILLED',
      terminal: true,
      fillsComplete: false,
      cumulativeFilledQuantity: '0.001',
      evidenceRevision: 'flatten-venue-id-collision-v1',
    });
    assert.equal(venueIdCollision.disposition, 'CONFLICT');
    assert.equal(
      venueIdCollision.code,
      'M0_ORDER_OBSERVATION_CONFLICT',
    );
    const flattenOrderQuery = await claimOrderQuery(store, flatten, clock);
    assert.equal(store.recordOrderObservation({
      leg: 'FLATTEN',
      ticketId: flatten.ticketId,
      queryAuthorizationId:
        flattenOrderQuery.receipt.authorizationId,
      venueOrderId: '70002',
      venueStatus: 'FILLED',
      terminal: true,
      fillsComplete: false,
      cumulativeFilledQuantity: '0.001',
      evidenceRevision: 'flatten-order-v1',
    }).disposition, 'COMMITTED_NEW');
    const flattenFillsQuery = await claimFillsQuery(
      store,
      flatten,
      '70002',
      clock,
    );
    assert.equal(store.recordFill({
      leg: 'FLATTEN',
      ticketId: flatten.ticketId,
      queryAuthorizationId:
        flattenFillsQuery.receipt.authorizationId,
      symbol: 'BTCUSDT',
      fills: Object.freeze([Object.freeze({
      fillId: '80002',
      venueOrderId: '70002',
      price: '9990',
      quantity: '0.001',
      quoteQuantity: '9.99',
      commission: '0.001',
      commissionAsset: 'USDT',
      occurredAtMs: T0,
      })]),
    }).disposition, 'COMMITTED_NEW');

    const flatState = store.read();
    assert.equal(flatState.residualQuantity, '0');
    assert.equal(flatState.fills.length, 2);
    assert.equal(ledger.readDurableMutationAuthority().posture, 'PROVEN_ABSENT');
    const staleFlatEvidence = exactFlatEvidence(flatState, {
      occurredAtMs: clock.nowMs(),
    });
    assert.equal(
      store.reconcileAndDisarm(staleFlatEvidence).disposition,
      'BLOCKED',
      'flat proof cannot disarm while a mutation permit may still settle',
    );
    clock.advance({ wallMs: 11_001, monotonicElapsedMs: 11_001 });
    assert.equal(
      store.reconcileAndDisarm(staleFlatEvidence).disposition,
      'BLOCKED',
      'a pre-window snapshot stays stale forever after time advances',
    );
    const freshFlatState = store.read();
    const disarmed = store.reconcileAndDisarm(exactFlatEvidence(
      freshFlatState,
      { occurredAtMs: clock.nowMs() },
    ));
    assert.equal(disarmed.disposition, 'COMMITTED_NEW');
    assert.equal(disarmed.state.phase, 'DISARMED_SAFE');
    assert.equal(disarmed.state.lifecycleLock, 'RELEASED');
    assert.equal(disarmed.state.newEntryArmed, false);
    assert.equal(disarmed.state.reconciliation.canonicalStatus, 'EXACT');
    assert.equal(disarmed.state.reconciliation.ledgerState, 'MATCHED');
    const postDisarmReplay = store.reserveAction({
      action: 'ENTRY',
      authority: entryAuthority,
      ticket: entry,
      intent: submitIntent,
    });
    assert.equal(postDisarmReplay.disposition, 'BLOCKED');
    assert.equal(postDisarmReplay.code, 'M0_EXECUTION_LEASE_REQUIRED');
    assert.equal(
      store.armLifecycle(card, entry, runtimeReadinessCard(card, entry)).disposition,
      'BLOCKED',
      'the durable lifecycle tombstone cannot be re-armed with stale readiness',
    );
    assert.equal(
      ledger.countEvents('system_integration.m0_spot.lifecycle_disarmed'),
      1,
    );
  } finally {
    ledger.close();
  }
});

test('authoritative -2013 absence needs repeated wall and monotonic settlement, then permits zero-fill disarm', async () => {
  const clock = mutableClock();
  const ledger = new M0InMemoryLedger(clock);
  try {
    const store = persistence(ledger, clock);
    const entry = entryTicket('absence');
    const card = lifecycleCard(entry);
    assert.equal(
      store.armLifecycle(card, entry, runtimeReadinessCard(card, entry)).disposition,
      'COMMITTED_NEW',
    );
    const intent = entryIntent(entry);
    assert.equal(
      store.acquireExecution(
        executionInput('cccccccccccccccccccccccccccccccc', '3'.repeat(64)),
      ).disposition,
      'ACQUIRED',
    );
    const entryAuthority = authority(store.read(), 'ENTRY', entry, intent);
    assert.equal(store.reserveAction({
      action: 'ENTRY',
      authority: entryAuthority,
      ticket: entry,
      intent,
    }).disposition, 'COMMITTED_NEW');
    const permit = await store.claimDispatch(Object.freeze({
      operation: 'SUBMIT',
      action: 'ENTRY',
      request: dispatchRequest('SUBMIT', entry),
      intent,
    }));
    assert.ok(permit);
    const spentBeforeCrash = await store.spend(Object.freeze({
      schema: 'cosmos.system-integration.binance-spot-egress-spend.v1',
      version: 1,
      lifecycleId: permit.lifecycleId,
      authorizationId: permit.receipt.authorizationId,
      permitDigest: permit.permitDigest,
      requestDigest: permit.requestDigest,
      executionRequestId: permit.executionLease.requestId,
      clockFenceId: permit.executionLease.clockFenceId,
      dispatchDeadlineAtMs: permit.dispatchDeadlineAtMs,
      dispatchDeadlineMonotonicMs:
        permit.dispatchDeadlineMonotonicMs,
    }));
    assert.ok(spentBeforeCrash);
    assert.equal(
      store.read().actions.find((action) =>
        action.receipt.authorizationId === entryAuthority.authorizationId)
        .egressConfirmation,
      null,
      'a process crash after spend leaves an ambiguous durable tombstone',
    );
    const firstAbsenceQuery = await claimOrderQuery(store, entry, clock);
    const firstAbsence = store.recordAuthoritativeAbsence({
      leg: 'ENTRY',
      ticketId: entry.ticketId,
      queryAuthorizationId:
        firstAbsenceQuery.receipt.authorizationId,
      originalClientOrderId: entry.clientOrderId,
      evidenceRevision: 'binance--2013-first-query-v1',
    });
    assert.equal(firstAbsence.disposition, 'COMMITTED_NEW');
    assert.equal(firstAbsence.state.entry.venueStatus, 'NOT_FOUND_PENDING_CONFIRMATION');
    assert.equal(firstAbsence.state.entry.terminal, false);
    assert.equal(firstAbsence.state.entry.notFoundObservationCount, 1);

    clock.advance({ wallMs: 11_001 });
    const wallAbsenceQuery = await claimOrderQuery(store, entry, clock);
    const wallOnly = store.recordAuthoritativeAbsence({
      leg: 'ENTRY',
      ticketId: entry.ticketId,
      queryAuthorizationId:
        wallAbsenceQuery.receipt.authorizationId,
      originalClientOrderId: entry.clientOrderId,
      evidenceRevision: 'binance--2013-wall-only-query-v1',
    });
    assert.equal(wallOnly.disposition, 'COMMITTED_NEW');
    assert.equal(wallOnly.state.entry.venueStatus, 'NOT_FOUND_PENDING_CONFIRMATION');
    assert.equal(wallOnly.state.entry.terminal, false);

    clock.advance({ monotonicElapsedMs: 11_001 });
    const settledAbsenceQuery = await claimOrderQuery(store, entry, clock);
    const absent = store.recordAuthoritativeAbsence({
      leg: 'ENTRY',
      ticketId: entry.ticketId,
      queryAuthorizationId:
        settledAbsenceQuery.receipt.authorizationId,
      originalClientOrderId: entry.clientOrderId,
      evidenceRevision: 'binance--2013-settled-query-v1',
    });
    assert.equal(absent.disposition, 'COMMITTED_NEW');
    assert.equal(absent.state.entry.venueStatus, 'AUTHORITATIVE_NOT_FOUND');
    assert.equal(absent.state.entry.terminal, true);
    assert.equal(absent.state.entry.fillsComplete, true);
    assert.equal(absent.state.entry.notFoundObservationCount, 3);
    assert.equal(absent.state.residualQuantity, '0');
    assert.equal(absent.state.fills.length, 0);
    assert.equal(ledger.readDurableMutationAuthority().posture, 'PROVEN_ABSENT');

    const reopened = persistence(ledger, clock).read();
    assert.equal(reopened?.stateDigest, absent.state.stateDigest);
    assert.equal(reopened?.entry.notFoundObservationCount, 3);

    const disarmed = store.reconcileAndDisarm(exactFlatEvidence(absent.state, {
      sourceVenueOrderId: null,
      sourceCumulativeFilledQuantity: '0',
      flattenTicketId: null,
      flattenClientOrderId: null,
      flattenVenueOrderId: null,
      flattenCumulativeFilledQuantity: '0',
      occurredAtMs: clock.nowMs(),
    }));
    assert.equal(disarmed.disposition, 'COMMITTED_NEW');
    assert.equal(disarmed.state.phase, 'DISARMED_SAFE');
    assert.equal(disarmed.state.residualQuantity, '0');
    assert.equal(
      disarmed.state.actions.find((action) =>
        action.receipt.authorizationId === entryAuthority.authorizationId)
        .egressConfirmation,
      null,
      'query recovery resolves venue absence without replaying the spend',
    );
    assert.equal(ledger.countEvents('order_request'), 1);
    assert.equal(ledger.countEvents('order_response'), 1);
    assert.equal(
      ledger.countEvents('system_integration.m0_spot.order_proven_absent'),
      1,
    );
  } finally {
    ledger.close();
  }
});

test('a FOUND order observation clears pending -2013 fields before further recovery decisions', async () => {
  const clock = mutableClock();
  const ledger = new M0InMemoryLedger(clock);
  try {
    const store = persistence(ledger, clock);
    const entry = entryTicket('found-after-2013');
    const card = lifecycleCard(entry);
    assert.equal(
      store.armLifecycle(card, entry, runtimeReadinessCard(card, entry)).disposition,
      'COMMITTED_NEW',
    );
    assert.equal(
      store.acquireExecution(
        executionInput('dddddddddddddddddddddddddddddddd', '4'.repeat(64)),
      ).disposition,
      'ACQUIRED',
    );
    const intent = entryIntent(entry);
    const entryAuthority = authority(store.read(), 'ENTRY', entry, intent);
    assert.equal(store.reserveAction({
      action: 'ENTRY', authority: entryAuthority, ticket: entry, intent,
    }).disposition, 'COMMITTED_NEW');
    assert.ok(await store.claimDispatch(Object.freeze({
      operation: 'SUBMIT', action: 'ENTRY', request: dispatchRequest('SUBMIT', entry), intent,
    })));
    const pendingQuery = await claimOrderQuery(store, entry, clock);
    const pending = store.recordAuthoritativeAbsence({
      leg: 'ENTRY',
      ticketId: entry.ticketId,
      queryAuthorizationId: pendingQuery.receipt.authorizationId,
      originalClientOrderId: entry.clientOrderId,
      evidenceRevision: 'binance--2013-pending-before-found-v1',
    });
    assert.equal(pending.state.entry.venueStatus, 'NOT_FOUND_PENDING_CONFIRMATION');

    const foundQuery = await claimOrderQuery(store, entry, clock);
    const found = store.recordOrderObservation({
      leg: 'ENTRY',
      ticketId: entry.ticketId,
      queryAuthorizationId: foundQuery.receipt.authorizationId,
      venueOrderId: '70003',
      venueStatus: 'NEW',
      terminal: false,
      fillsComplete: false,
      cumulativeFilledQuantity: '0',
      evidenceRevision: 'binance-order-found-v1',
    });
    assert.equal(found.disposition, 'COMMITTED_NEW');
    assert.equal(found.state.entry.venueStatus, 'NEW');
    assert.equal(found.state.entry.notFoundFirstObservedAtMs, null);
    assert.equal(found.state.entry.notFoundFirstObservedMonotonicMs, null);
    assert.equal(found.state.entry.notFoundObservationCount, 0);
    assert.deepEqual(found.state.entry.notFoundEvidenceRevisions, []);
    assert.deepEqual(found.state.entry.notFoundQueryAuthorizationIds, []);
    assert.equal(
      found.state.actions.find((row) =>
        row.receipt.authorizationId === entryAuthority.authorizationId,
      ).outcome,
      'accepted_reconciled',
      'the same FOUND CAS reconciles only its exact dispatched mutation',
    );
    assert.equal(persistence(ledger, clock).read()?.stateDigest, found.state.stateDigest);
  } finally {
    ledger.close();
  }
});

test('late FOUND reopens an authoritatively absent historical flatten and permits one exact historical cancel', async () => {
  const clock = mutableClock();
  const ledger = new M0InMemoryLedger(clock);
  try {
    const store = persistence(ledger, clock);
    const entry = entryTicket('late-historical-flatten');
    const card = lifecycleCard(entry);
    assert.equal(
      store.armLifecycle(
        card,
        entry,
        runtimeReadinessCard(card, entry),
      ).disposition,
      'COMMITTED_NEW',
    );
    assert.equal(store.acquireExecution(
      executionInput('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '5'.repeat(64)),
    ).disposition, 'ACQUIRED');
    const entryIntentValue = entryIntent(entry);
    const entryAuthority = authority(
      store.read(),
      'ENTRY',
      entry,
      entryIntentValue,
    );
    assert.equal(store.reserveAction({
      action: 'ENTRY',
      authority: entryAuthority,
      ticket: entry,
      intent: entryIntentValue,
    }).disposition, 'COMMITTED_NEW');
    assert.ok(await store.claimDispatch(Object.freeze({
      operation: 'SUBMIT',
      action: 'ENTRY',
      request: dispatchRequest('SUBMIT', entry),
      intent: entryIntentValue,
    })));
    assert.equal(store.recordMutationOutcome({
      authorizationId: entryAuthority.authorizationId,
      outcome: 'accepted_reconciled',
      detail: 'entry identity accepted before flatten recovery',
    }).disposition, 'COMMITTED_NEW');
    const lateEntryOrderQuery = await claimOrderQuery(store, entry, clock);
    assert.equal(store.recordOrderObservation({
      leg: 'ENTRY',
      ticketId: entry.ticketId,
      queryAuthorizationId:
        lateEntryOrderQuery.receipt.authorizationId,
      venueOrderId: '71001',
      venueStatus: 'FILLED',
      terminal: true,
      fillsComplete: false,
      cumulativeFilledQuantity: entry.quantity,
      evidenceRevision: 'late-history-entry-found-v1',
    }).disposition, 'COMMITTED_NEW');
    const lateEntryFillsQuery = await claimFillsQuery(
      store,
      entry,
      '71001',
      clock,
    );
    assert.equal(store.recordFill({
      leg: 'ENTRY',
      ticketId: entry.ticketId,
      queryAuthorizationId:
        lateEntryFillsQuery.receipt.authorizationId,
      symbol: entry.symbol,
      fills: Object.freeze([Object.freeze({
      fillId: '81001',
      venueOrderId: '71001',
      price: entry.price,
      quantity: entry.quantity,
      quoteQuantity: entry.orderNotionalQuote,
      commission: '0',
      commissionAsset: 'USDT',
      occurredAtMs: T0,
      })]),
    }).disposition, 'COMMITTED_NEW');

    const firstFlatten = flattenTicket(entry, 'primary');
    const firstIntent = flattenIntent(entry, firstFlatten);
    const firstAuthority = authority(
      store.read(),
      'FLATTEN',
      firstFlatten,
      firstIntent,
    );
    assert.equal(store.reserveAction({
      action: 'FLATTEN',
      authority: firstAuthority,
      ticket: firstFlatten,
      intent: firstIntent,
    }).disposition, 'COMMITTED_NEW');
    assert.ok(await store.claimDispatch(Object.freeze({
      operation: 'FLATTEN',
      action: 'FLATTEN',
      request: dispatchRequest('FLATTEN', firstFlatten),
      intent: firstIntent,
    })));
    assert.equal(store.recordMutationOutcome({
      authorizationId: firstAuthority.authorizationId,
      outcome: 'unknown',
      detail: 'flatten outcome requires query by original client identity',
    }).disposition, 'COMMITTED_NEW');
    const firstFlattenAbsenceQuery = await claimOrderQuery(
      store,
      firstFlatten,
      clock,
    );
    assert.equal(store.recordAuthoritativeAbsence({
      leg: 'FLATTEN',
      ticketId: firstFlatten.ticketId,
      queryAuthorizationId:
        firstFlattenAbsenceQuery.receipt.authorizationId,
      originalClientOrderId: firstFlatten.clientOrderId,
      evidenceRevision: 'flatten-attempt-1-absence-query-1',
    }).disposition, 'COMMITTED_NEW');
    clock.advance({ wallMs: 11_001, monotonicElapsedMs: 11_001 });
    const settledFlattenAbsenceQuery = await claimOrderQuery(
      store,
      firstFlatten,
      clock,
    );
    const firstAbsent = store.recordAuthoritativeAbsence({
      leg: 'FLATTEN',
      ticketId: firstFlatten.ticketId,
      queryAuthorizationId:
        settledFlattenAbsenceQuery.receipt.authorizationId,
      originalClientOrderId: firstFlatten.clientOrderId,
      evidenceRevision: 'flatten-attempt-1-absence-query-2',
    });
    assert.equal(firstAbsent.disposition, 'COMMITTED_NEW');
    assert.equal(
      firstAbsent.state.flatten.venueStatus,
      'AUTHORITATIVE_NOT_FOUND',
    );
    assert.equal(
      firstAbsent.state.actions.find((row) =>
        row.receipt.authorizationId === firstAuthority.authorizationId,
      ).dispatchClaimed,
      true,
      'claimed mutation settles only beyond its full acceptance window',
    );

    const secondFlatten = flattenTicket(entry, 'secondary');
    const secondIntent = flattenIntent(entry, secondFlatten);
    const secondAuthority = authority(
      store.read(),
      'FLATTEN',
      secondFlatten,
      secondIntent,
      { nowMs: clock.nowMs(), monotonicMs: clock.monotonicMs() },
    );
    assert.equal(store.reserveAction({
      action: 'FLATTEN',
      authority: secondAuthority,
      ticket: secondFlatten,
      intent: secondIntent,
    }).disposition, 'COMMITTED_NEW');
    assert.equal(store.read().flattenHistory[0].ticket.ticketId, firstFlatten.ticketId);

    const lateFoundQuery = await claimOrderQuery(
      store,
      firstFlatten,
      clock,
    );
    const lateFound = store.recordOrderObservation({
      leg: 'FLATTEN',
      ticketId: firstFlatten.ticketId,
      queryAuthorizationId:
        lateFoundQuery.receipt.authorizationId,
      venueOrderId: '72001',
      venueStatus: 'NEW',
      terminal: false,
      fillsComplete: false,
      cumulativeFilledQuantity: '0',
      evidenceRevision: 'flatten-attempt-1-late-found-v1',
    });
    assert.equal(
      lateFound.disposition,
      'COMMITTED_NEW',
      JSON.stringify(lateFound),
    );
    assert.equal(lateFound.state.phase, 'RECOVERY_REQUIRED');
    assert.equal(lateFound.state.reconciliation, null);
    assert.equal(lateFound.state.flattenHistory[0].venueOrderId, '72001');
    assert.equal(lateFound.state.flattenHistory[0].terminal, false);
    assert.equal(lateFound.state.flatten.ticket.ticketId, secondFlatten.ticketId);
    assert.equal(
      lateFound.state.actions.find((row) =>
        row.receipt.authorizationId === firstAuthority.authorizationId,
      ).outcome,
      'accepted_reconciled',
    );

    const cancelIntent = Object.freeze({
      kind: 'CANCEL_BY_ORIGINAL_CLIENT_ORDER_ID',
      ticketId: firstFlatten.ticketId,
      symbol: firstFlatten.symbol,
      originalClientOrderId: firstFlatten.clientOrderId,
      automaticRetry: false,
    });
    const cancelAuthority = authority(
      store.read(),
      'FLATTEN_CANCEL',
      firstFlatten,
      cancelIntent,
      { nowMs: clock.nowMs(), monotonicMs: clock.monotonicMs() },
    );
    assert.equal(store.reserveAction({
      action: 'FLATTEN_CANCEL',
      authority: cancelAuthority,
      ticket: firstFlatten,
      intent: cancelIntent,
    }).disposition, 'COMMITTED_NEW');
    const cancelClaimInput = Object.freeze({
      operation: 'CANCEL',
      action: 'FLATTEN_CANCEL',
      request: cancelDispatchRequest(firstFlatten),
      intent: cancelIntent,
    });
    assert.equal(await store.claimDispatch(Object.freeze({
      ...cancelClaimInput,
      request: withDispatchParameter(
        cancelClaimInput.request,
        'origClientOrderId',
        secondFlatten.clientOrderId,
      ),
    })), null);
    const cancelPermit = await store.claimDispatch(cancelClaimInput);
    assert.equal(cancelPermit?.action, 'FLATTEN_CANCEL');
    assert.equal(
      cancelPermit?.ticketId,
      firstFlatten.ticketId,
      'historical exact ticket, not current flatten, owns the cancel',
    );
    assert.equal(
      store.reserveAction({
        action: 'FLATTEN_CANCEL',
        authority: authority(
          store.read(),
          'FLATTEN_CANCEL',
          firstFlatten,
          cancelIntent,
          { nowMs: clock.nowMs(), monotonicMs: clock.monotonicMs() },
        ),
        ticket: firstFlatten,
        intent: cancelIntent,
      }).disposition,
      'BLOCKED',
      'one historical attempt can never mint a second cancel',
    );
  } finally {
    ledger.close();
  }
});

test('an owned execution can park and must reacquire before the provably zero-exposure lifecycle disarms', () => {
  const ledger = new M0InMemoryLedger();
  try {
    const store = persistence(ledger);
    const entry = entryTicket('zero-exposure');
    const card = lifecycleCard(entry);
    assert.equal(
      store.armLifecycle(card, entry, runtimeReadinessCard(card, entry)).disposition,
      'COMMITTED_NEW',
    );
    const lease = executionInput('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '5'.repeat(64));
    assert.equal(store.acquireExecution(lease).disposition, 'ACQUIRED');
    assert.equal(store.parkExecution(lease.requestId).disposition, 'COMMITTED_NEW');
    assert.equal(store.read().execution.status, 'PARKED');
    const parkedDisarm = store.disarmBeforeEntry('operator-cancelled-before-entry');
    assert.equal(parkedDisarm.disposition, 'BLOCKED');
    assert.equal(parkedDisarm.code, 'M0_NO_EXPOSURE_DISARM_NOT_PROVED');

    assert.equal(store.acquireExecution(lease).disposition, 'ACQUIRED');
    const disarmed = store.disarmBeforeEntry('operator-cancelled-before-entry');
    assert.equal(disarmed.disposition, 'COMMITTED_NEW');
    assert.equal(disarmed.state.phase, 'DISARMED_NO_EXPOSURE');
    assert.equal(disarmed.state.lifecycleLock, 'RELEASED');
    assert.equal(disarmed.state.residualQuantity, '0');
    const reread = persistence(ledger).read();
    assert.equal(reread?.stateDigest, disarmed.state.stateDigest);
    assert.equal(reread?.phase, 'DISARMED_NO_EXPOSURE');
  } finally {
    ledger.close();
  }
});
