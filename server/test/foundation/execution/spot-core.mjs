import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SPOT_OWNER_SEND_AUTHORITY_SCHEMA,
  SPOT_RISK_EVIDENCE_SCHEMA,
  SPOT_SIGNED_TEST_EVIDENCE_SCHEMA,
  correlateSpotTicket,
  decideSpotLiveSend,
  prepareSpotCore,
} from '../../../dist/foundation/execution/spotCore.js';
import { decideSpotAttempt } from '../../../dist/foundation/execution/spotAttemptPolicy.js';
import { createSpotExecutionTicket } from '../../../dist/foundation/execution/spotTicket.js';
import {
  buildSpotLedgerAppendIntent,
  spotCorrelationKeys,
} from '../../../dist/foundation/reconciliation/spotLedgerBridge.js';
import { planSpotRestartRecovery } from '../../../dist/foundation/reconciliation/spotRestartRecovery.js';
import { REQUEST_ATTEMPT_SCHEMA } from '../../../dist/liveEdge/adapters/binanceSignedKernel/ambiguity.js';

const FILTERS = Object.freeze([
  Object.freeze({
    filterType: 'PRICE_FILTER',
    minPrice: '0.01',
    maxPrice: '1000000',
    tickSize: '0.01',
  }),
  Object.freeze({
    filterType: 'LOT_SIZE',
    minQty: '0.001',
    maxQty: '1000',
    stepSize: '0.001',
  }),
  Object.freeze({
    filterType: 'MIN_NOTIONAL',
    minNotional: '1',
    applyToMarket: true,
    avgPriceMins: 5,
  }),
]);

function ticket(overrides = {}) {
  return createSpotExecutionTicket({
    correlationId: 'correlation-spot-core-1',
    planId: 'plan-spot-core-1',
    accountId: 'account-spot-core-1',
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: '0.05',
    price: '100',
    riskReferencePrice: '100',
    estimatedMaxLossQuote: '1',
    purpose: 'ENTRY',
    attempt: 0,
    createdAtMs: 1_000,
    expiresAtMs: 10_000,
    ...overrides,
  });
}

function riskEvidence(value, overrides = {}) {
  return {
    schema: SPOT_RISK_EVIDENCE_SCHEMA,
    verification: 'VERIFIED_BY_CANONICAL_RISK_OWNER',
    evidenceRevision: 'risk-evidence-revision-1',
    policyRevision: 'risk-policy-revision-1',
    policy: {
      minOrderNotionalQuote: '1',
      maxOrderNotionalQuote: '10',
      maxLossPerOrderQuote: '2',
      maxDailyLossQuote: '10',
    },
    ticketId: value.ticketId,
    termsDigest: value.termsDigest,
    accountId: value.accountId,
    symbol: value.symbol,
    observedAtMs: 1_500,
    validUntilMs: 9_000,
    killSwitchEngaged: false,
    realizedDailyLossQuote: '0',
    riskReduction: null,
    ...overrides,
  };
}

function input(value, overrides = {}) {
  return {
    ticket: value,
    filterSnapshot: {
      revision: 'exchange-info-revision-1',
      observedAtMs: 1_400,
      filters: FILTERS,
    },
    nowMs: 2_000,
    riskEvidence: riskEvidence(value),
    ...overrides,
  };
}

function signedTestEvidence(value) {
  return {
    schema: SPOT_SIGNED_TEST_EVIDENCE_SCHEMA,
    evidenceId: 'signed-test-evidence-1',
    status: 'ACCEPTED',
    ticketId: value.ticketId,
    termsDigest: value.termsDigest,
    clientOrderId: value.clientOrderId,
    filterSnapshotRevision: 'exchange-info-revision-1',
    observedAtMs: 2_500,
    createsVenueOrder: false,
  };
}

function ownerAuthority(value, overrides = {}) {
  return {
    schema: SPOT_OWNER_SEND_AUTHORITY_SCHEMA,
    authorizationId: 'owner-single-send-1',
    verification: 'VERIFIED_BY_CANONICAL_OWNER_AUTHORITY',
    ticketId: value.ticketId,
    termsDigest: value.termsDigest,
    clientOrderId: value.clientOrderId,
    maxOrderNotionalQuote: '10',
    confirmedAtMs: 3_000,
    expiresAtMs: 8_000,
    singleUse: true,
    ...overrides,
  };
}

test('preparation binds exact ticket, risk evidence, filters, and a non-live signed test', () => {
  const value = ticket();
  const result = prepareSpotCore(input(value));

  assert.equal(result.readyForSignedTest, true);
  assert.deepEqual(result.blockingCodes, []);
  assert.equal(result.riskVerdict.orderNotionalQuote, '5');
  assert.equal(result.filterValidation.notional, '5');
  assert.equal(result.signedTestRequired, true);
  assert.equal(result.signedTestIntent?.createsVenueOrder, false);
  assert.equal(result.signedTestIntent?.liveSendAuthorized, false);
  assert.equal(result.liveSendAuthorized, false);
  assert.equal(result.sendsPerformed, 0);
});

test('risk evidence must bind the exact ticket identity', () => {
  const value = ticket();
  const result = prepareSpotCore(
    input(value, {
      riskEvidence: riskEvidence(value, { ticketId: 'different-ticket' }),
    }),
  );

  assert.equal(result.readyForSignedTest, false);
  assert.ok(result.blockingCodes.includes('RISK_EVIDENCE_BINDING_MISMATCH'));
});

test('flatten remains unproven until exact reconciled SELL position evidence covers quantity', () => {
  const value = ticket({
    side: 'SELL',
    purpose: 'FLATTEN',
  });
  const blocked = prepareSpotCore(input(value));
  assert.equal(value.riskEffect, 'UNPROVEN_RISK_REDUCTION');
  assert.ok(blocked.blockingCodes.includes('RISK_REDUCTION_UNPROVEN'));

  const proven = prepareSpotCore(
    input(value, {
      riskEvidence: riskEvidence(value, {
        riskReduction: {
          basis: 'RECONCILED_SPOT_BASE_REDUCTION',
          positionSnapshotRevision: 'position-revision-1',
          reconciliationStatus: 'EXACT',
          side: 'SELL',
          availableBaseQuantity: '0.05',
        },
      }),
    }),
  );
  assert.equal(proven.readyForSignedTest, true);
});

test('live-send decision stays inert and requires both readiness gates, accepted test, and single-use owner proof', () => {
  const value = ticket();
  const base = {
    ...input(value, {
      nowMs: 4_000,
      riskEvidence: riskEvidence(value),
    }),
    readiness: { backupReady: true, privateReadReady: true },
    signedTestEvidence: signedTestEvidence(value),
    ownerAuthority: ownerAuthority(value),
  };
  const allowed = decideSpotLiveSend(base);

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.sendsPerformed, 0);
  assert.equal(allowed.automaticRetry, false);
  assert.equal(allowed.intent?.kind, 'SUBMIT_LIVE_ORDER');
  assert.equal(allowed.intent?.singleUse, true);

  const notReady = decideSpotLiveSend({
    ...base,
    readiness: { backupReady: true, privateReadReady: false },
  });
  assert.equal(notReady.allowed, false);
  assert.equal(notReady.intent, null);
  assert.ok(notReady.blockingCodes.includes('PRIVATE_READ_NOT_READY'));

  const overCeiling = decideSpotLiveSend({
    ...base,
    ownerAuthority: ownerAuthority(value, {
      maxOrderNotionalQuote: '10.0000000000000000001',
    }),
  });
  assert.equal(overCeiling.allowed, false);
  assert.ok(
    overCeiling.blockingCodes.includes('OWNER_AUTHORITY_CEILING_INVALID'),
  );
});

test('kill switch blocks again at the final send seam', () => {
  const value = ticket();
  const decision = decideSpotLiveSend({
    ...input(value, {
      nowMs: 4_000,
      riskEvidence: riskEvidence(value, { killSwitchEngaged: true }),
    }),
    readiness: { backupReady: true, privateReadReady: true },
    signedTestEvidence: signedTestEvidence(value),
    ownerAuthority: ownerAuthority(value),
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.intent, null);
  assert.ok(decision.blockingCodes.includes('KILL_SWITCH_ENGAGED'));
  assert.ok(decision.blockingCodes.includes('RISK_POLICY_BLOCKED'));
});

test('canonical ambiguous attempt queries the same client ID and never resubmits', () => {
  const value = ticket();
  const decision = decideSpotAttempt({
    canonicalAttempt: {
      schema: REQUEST_ATTEMPT_SCHEMA,
      version: 1,
      operationClass: 'MUTATION',
      requestId: 'lrq_0123456789abcdef0123456789abcdef',
      clientOrderId: value.clientOrderId,
      stage: 'UNKNOWN',
      revision: 2,
      submitCount: 1,
      transportOutcome: 'TIMEOUT',
      httpStatus: null,
      ambiguityCause: 'TRANSPORT_TIMEOUT',
      noDispatchProof: null,
      terminalEvidenceRef: null,
      reconciliationRequired: true,
      duplicateSendBlocked: true,
      automaticResubmission: false,
    },
    killSwitchEngaged: false,
  });

  assert.equal(decision.action, 'QUERY_ORIGINAL_CLIENT_ID');
  assert.equal(decision.queryClientOrderId, value.clientOrderId);
  assert.equal(decision.automaticResubmission, false);
});

test('ticket-bound correlation carries exact fill truth into ledger and query-first restart recovery', () => {
  const value = ticket();
  const correlation = correlateSpotTicket(value, {
    orderId: 'venue-order-1',
    fillId: 'venue-fill-1',
    cancelId: null,
    flattenId: null,
    attemptKind: 'ORDER',
  });
  const keys = spotCorrelationKeys(correlation);
  assert.match(keys.ticket, new RegExp(value.ticketId));
  assert.match(keys.clientOrder, new RegExp(value.clientOrderId));

  const fill = buildSpotLedgerAppendIntent(
    {
      eventKind: 'FILL',
      eventRevision: 'fill-revision-1',
      symbol: value.symbol,
      correlation,
      side: value.side,
      baseQuantity: '0.01',
      quoteQuantity: '1',
      feeQuantity: '0.00001',
      feeAsset: 'BNB',
      occurredAtMs: 3_500,
      status: 'PARTIAL',
    },
    { nowMs: () => 4_000 },
  );
  assert.equal(fill.data.baseQuantity, '0.01');
  assert.equal(fill.data.quoteQuantity, '1');
  assert.equal(fill.data.feeQuantity, '0.00001');

  const recovery = planSpotRestartRecovery(
    'restart-spot-core-1',
    [
      {
        symbol: value.symbol,
        correlation,
        attemptState: 'AMBIGUOUS',
        exchangeQueryState: 'NOT_QUERIED',
        canonicalStatus: null,
      },
    ],
    { nowMs: () => 4_000 },
  );
  assert.equal(recovery.steps[0].kind, 'QUERY_BY_CLIENT_ORDER_ID');
  assert.equal(recovery.steps[0].retryAuthorized, false);
  assert.equal(recovery.sendsPerformed, 0);
});
