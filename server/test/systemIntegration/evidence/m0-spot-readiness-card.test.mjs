import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M0_SPOT_EXECUTABLE_ENTRY_EVIDENCE_SCHEMA,
  M0_SPOT_READINESS_CARD_SCHEMA,
  M0_SPOT_READINESS_MAX_FRESHNESS_MS,
  M0_SPOT_MAX_RESIDUAL_DUST_NOTIONAL_QUOTE,
  M0_SPOT_PERMISSION_TRANSITIONS,
  M0_SPOT_SOURCE_LIMITATION,
  calculateM0SpotExecutableEntryEvidenceDigest,
  calculateM0SpotReadinessDigest,
  projectM0SpotSourceReadinessCard,
} from '../../../dist/systemIntegration/evidence/m0SpotReadinessCard.js';
import {
  M0_SPOT_ACTION_ALLOWLIST,
} from '../../../dist/foundation/execution/m0SpotLifecycleCard.js';

const OBSERVED_AT_MS = 0;

function withoutReadinessDigest(card) {
  const { readinessDigest: _discarded, ...withoutDigest } = card;
  return withoutDigest;
}

test('source §7 readiness card is deterministic, immutable and digest bound', () => {
  const first = projectM0SpotSourceReadinessCard(OBSERVED_AT_MS);
  const second = projectM0SpotSourceReadinessCard(OBSERVED_AT_MS);

  assert.deepEqual(first, second);
  assert.equal(first.schema, M0_SPOT_READINESS_CARD_SCHEMA);
  assert.equal(
    first.observedTimestampIst,
    '1970-01-01T05:30:00.000+05:30',
  );
  assert.equal(M0_SPOT_READINESS_MAX_FRESHNESS_MS, 5_000);
  assert.equal(M0_SPOT_MAX_RESIDUAL_DUST_NOTIONAL_QUOTE, '0.01');
  assert.match(first.readinessDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    first.readinessDigest,
    calculateM0SpotReadinessDigest(withoutReadinessDigest(first)),
  );
  assert.notEqual(
    projectM0SpotSourceReadinessCard(1).readinessDigest,
    first.readinessDigest,
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.effects), true);
  assert.equal(Object.isFrozen(first.order.allowlist), true);
});

test('source §7 defaults never imply runtime proof or executable authority', () => {
  const card = projectM0SpotSourceReadinessCard(OBSERVED_AT_MS);

  assert.equal(card.lifecycleCardDigest, null);
  assert.equal(card.executableEntryEvidenceDigest, null);
  assert.equal(card.validUntilMs, null);
  assert.equal(card.disposition, 'SOURCE_READY_NOT_RUNTIME_VERIFIED');
  assert.equal(card.gate2Ready, false);
  assert.equal(card.evidenceAuthority, 'SOURCE_ONLY');
  assert.equal(card.ownerId, null);
  assert.equal(card.ownerAction, 'NO');
  assert.deepEqual(card.appExecutionArmed, {
    state: 'VERIFIED_CURRENT',
    current: false,
    proposed: 'REMAIN_DISARMED',
  });
  assert.deepEqual(card.namedExecutor, {
    state: 'UNKNOWN_NOT_VERIFIED',
    executorId: null,
    hostId: null,
    bootId: null,
    processId: null,
    authority: 'NONE',
  });
  assert.equal(card.accountCanTrade.value, null);
  assert.equal(card.accountMode.privateReadVerified, false);
  assert.deepEqual(
    {
      accountCanTrade: card.accountCanTrade.value,
      reading: card.apiKeyPermissions.readingEnabled,
      spot: card.apiKeyPermissions.spotTradeEnabled,
      ip: card.apiKeyPermissions.ipRestricted,
      withdrawal: card.apiKeyPermissions.withdrawalsEnabled,
      internalTransfer:
        card.apiKeyPermissions.internalTransfersEnabled,
      universalTransfer:
        card.apiKeyPermissions.universalTransfersEnabled,
      margin: card.apiKeyPermissions.marginEnabled,
      futures: card.apiKeyPermissions.futuresEnabled,
      options: card.apiKeyPermissions.vanillaOptionsEnabled,
      fixTrade: card.apiKeyPermissions.fixTradeEnabled,
      fixRead: card.apiKeyPermissions.fixReadOnlyEnabled,
      portfolio: card.apiKeyPermissions.portfolioMarginEnabled,
    },
    {
      accountCanTrade: null,
      reading: null,
      spot: null,
      ip: null,
      withdrawal: null,
      internalTransfer: null,
      universalTransfer: null,
      margin: null,
      futures: null,
      options: null,
      fixTrade: null,
      fixRead: null,
      portfolio: null,
    },
    'unobserved source permissions stay nullable rather than false',
  );
  assert.deepEqual(card.order.allowlist, []);
  assert.equal(card.order.symbol, null);
  assert.equal(card.order.price, null);
  assert.equal(card.order.timeInForce, 'FOK');
  assert.equal(card.order.quoteAmount, null);
  assert.equal(card.order.baseQuantity, null);
  assert.equal(card.filters.completeSnapshotDigest, null);
  assert.deepEqual(card.liquidity, {
    state: 'UNKNOWN_NOT_VERIFIED',
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
  });
  assert.equal(card.economics.totalFeeReserveQuote, null);
  assert.equal(card.baseline.matched, null);
  assert.equal(card.recovery.exchangeBaseTolerance, null);
  assert.equal(card.recovery.maximumResidualDustNotionalQuote, '0.01');
  assert.equal(card.rollback.procedure, null);
});

test('executable entry digest binds every data-only entry evidence family', () => {
  const evidence = {
    schema: M0_SPOT_EXECUTABLE_ENTRY_EVIDENCE_SCHEMA,
    version: 1,
    ticket: {
      schema: 'cosmos.foundation.spot-execution-ticket.v1',
      ticketId: 'spt_0123456789abcdef0123456789abcdef',
      termsDigest: '0123456789abcdef0123456789abcdef',
      legId: 'leg-entry',
      correlationId: 'cor-entry',
      planId: 'plan-entry',
      accountId: 'account-4',
      venue: 'BINANCE_SPOT',
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      timeInForce: 'FOK',
      quantity: '0.001',
      price: '10000',
      riskReferencePrice: '10000',
      notionalPrice: '10000',
      orderNotionalQuote: '10',
      estimatedMaxLossQuote: '0.25',
      purpose: 'ENTRY',
      riskEffect: 'RISK_INCREASING',
      attempt: 1,
      clientOrderId: 'm0_entry_0001',
      createdAtMs: 1_900_000_000_000,
      expiresAtMs: 1_900_000_005_000,
    },
    filterSnapshot: {
      revision: 'filters-v1',
      observedAtMs: 1_900_000_000_000,
      filters: [
        {
          filterType: 'PRICE_FILTER',
          minPrice: '0.01',
          maxPrice: '1000000',
          tickSize: '0.01',
        },
      ],
    },
    documentaryNowMs: 1_900_000_000_100,
    riskEvidence: {
      schema: 'cosmos.foundation.spot-risk-evidence.v1',
      verification: 'VERIFIED_BY_CANONICAL_RISK_OWNER',
      evidenceRevision: 'risk-v1',
      policyRevision: 'policy-v1',
      policy: {
        maximumOrderNotionalQuote: '10',
        maximumGrossLifecycleTurnoverQuote: '20',
      },
      ticketId: 'spt_0123456789abcdef0123456789abcdef',
      termsDigest: '0123456789abcdef0123456789abcdef',
      accountId: 'account-4',
      symbol: 'BTCUSDT',
      observedAtMs: 1_900_000_000_000,
      validUntilMs: 1_900_000_005_000,
      killSwitchEngaged: false,
      realizedDailyLossQuote: '0',
      riskReduction: null,
    },
    venueEvidence: {
      referencePrice: {
        state: 'SET',
        price: '10000',
        providerCloseTimeMs: 1_900_000_000_000,
      },
      fallbackPrices: [],
      executionRules: [
        { ruleType: 'PRICE_RANGE', minPrice: '9000' },
      ],
    },
    readiness: {
      backupReady: true,
      privateReadReady: true,
    },
    signedTestEvidence: {
      schema: 'cosmos.foundation.spot-signed-test-evidence.v1',
      evidenceId: 'signed-test-v1',
      status: 'ACCEPTED',
      ticketId: 'spt_0123456789abcdef0123456789abcdef',
      termsDigest: '0123456789abcdef0123456789abcdef',
      clientOrderId: 'm0_entry_0001',
      filterSnapshotRevision: 'filters-v1',
      observedAtMs: 1_900_000_000_000,
      createsVenueOrder: false,
    },
    ownerAuthorityEvidence: {
      schema: 'cosmos.foundation.spot-owner-send-authority.v1',
      authorizationId: 'owner-auth-v1',
      verification: 'VERIFIED_BY_CANONICAL_OWNER_AUTHORITY',
      ticketId: 'spt_0123456789abcdef0123456789abcdef',
      termsDigest: '0123456789abcdef0123456789abcdef',
      clientOrderId: 'm0_entry_0001',
      maxOrderNotionalQuote: '10',
      confirmedAtMs: 1_900_000_000_000,
      expiresAtMs: 1_900_000_005_000,
      singleUse: true,
    },
  };
  const digest = calculateM0SpotExecutableEntryEvidenceDigest(evidence);

  assert.match(digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    calculateM0SpotExecutableEntryEvidenceDigest(
      structuredClone(evidence),
    ),
    digest,
  );
  for (const mutate of [
    (copy) => { copy.ticket.price = '10001'; },
    (copy) => { copy.filterSnapshot.filters[0].tickSize = '0.1'; },
    (copy) => {
      copy.riskEvidence.policy.maximumOrderNotionalQuote = '9';
    },
    (copy) => {
      copy.venueEvidence.executionRules[0].minPrice = '9500';
    },
    (copy) => { copy.readiness.backupReady = false; },
    (copy) => { copy.signedTestEvidence.status = 'REJECTED'; },
    (copy) => { copy.ownerAuthorityEvidence.expiresAtMs += 1; },
  ]) {
    const copy = structuredClone(evidence);
    mutate(copy);
    assert.notEqual(
      calculateM0SpotExecutableEntryEvidenceDigest(copy),
      digest,
    );
  }
  assert.deepEqual(
    Object.keys(evidence.ownerAuthorityEvidence).sort(),
    [
      'authorizationId',
      'clientOrderId',
      'confirmedAtMs',
      'expiresAtMs',
      'maxOrderNotionalQuote',
      'schema',
      'singleUse',
      'termsDigest',
      'ticketId',
      'verification',
    ],
    'authority evidence contains bindings/times, never secrets/capability',
  );
});

test('source §7 fixes the bounded Spot routes, lifecycle law and no-effect receipt', () => {
  const card = projectM0SpotSourceReadinessCard(OBSERVED_AT_MS);

  assert.deepEqual(card.venueRoutes, {
    venue: 'BINANCE_SPOT',
    compositionState: 'SOURCE_IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    signedTest: { method: 'POST', path: '/api/v3/order/test' },
    entry: { method: 'POST', path: '/api/v3/order' },
    query: { method: 'GET', path: '/api/v3/order' },
    cancel: { method: 'DELETE', path: '/api/v3/order' },
    fills: { method: 'GET', path: '/api/v3/myTrades' },
  });
  assert.deepEqual(card.excludedCapabilities, {
    state: 'SOURCE_IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    futuresRoute: {
      access: 'INACCESSIBLE_TO_M0',
      route: null,
    },
    marginBorrow: {
      access: 'INACCESSIBLE_TO_M0',
      route: null,
      borrowAuthority: 'NONE',
    },
    leverage: {
      availability: 'UNAVAILABLE',
      value: null,
    },
  });
  assert.deepEqual(M0_SPOT_PERMISSION_TRANSITIONS, {
    ACCOUNT_ONLY:
      'RESTORE_ACCOUNT_SPOT_TRADING_ELIGIBILITY_ONLY',
    EXECUTION_PROFILE_ONLY:
      'ENABLE_SPOT_AND_MARGIN_TRADING_ON_NAMED_EXECUTION_PROFILE_ONLY',
    ACCOUNT_AND_EXECUTION_PROFILE:
      'RESTORE_ACCOUNT_SPOT_TRADING_ELIGIBILITY_AND_ENABLE_SPOT_AND_MARGIN_TRADING_ON_NAMED_EXECUTION_PROFILE_ONLY',
  });
  assert.deepEqual(card.executorActionAllowlist, M0_SPOT_ACTION_ALLOWLIST);
  assert.equal(card.limits.maximumFlattenSubmissions, 3);
  assert.equal(card.limits.maximumFlattenCancelSubmissions, 3);
  assert.equal(card.limits.maximumResidualDustNotionalQuote, '0.01');
  assert.deepEqual(card.timing, {
    requestTimeoutMs: 5000,
    recvWindowMs: 5000,
    queryBeforeRetry: true,
    blindResend: false,
  });
  assert.deepEqual(card.lifecycle, {
    state: 'SOURCE_IMPLEMENTED_NOT_RUNTIME_VERIFIED',
    oneEntry: true,
    oneLifecycle: true,
    blindResend: false,
    recoveryAuthorizedUntilFlat: true,
    finalDisarmAfterVenueAndLocalFlat: true,
  });
  assert.equal(card.recovery.remainsAuthorizedAfterKill, true);
  assert.equal(card.recovery.remainsAuthorizedAcrossRestart, true);
  assert.equal(card.recovery.cancelExactOrderOnly, true);
  assert.equal(card.recovery.flattenExactResidualOnly, true);
  assert.equal(card.ledgerReconciliation.venueEqualsLocal, null);
  assert.deepEqual(card.effects, {
    privateCalls: 0,
    signatures: 0,
    transportCalls: 0,
    authorityConsumptions: 0,
    ledgerWrites: 0,
    orders: 0,
    moneyMutations: 0,
  });
  assert.equal(card.exactLimitation, M0_SPOT_SOURCE_LIMITATION);
  assert.equal(card.residualCondition, 'SOURCE_READY_NOT_RUNTIME_VERIFIED');
});

test('readiness projection rejects invalid observation times without effects', () => {
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    assert.throws(
      () => projectM0SpotSourceReadinessCard(value),
      /observation time is invalid/u,
    );
  }
});
