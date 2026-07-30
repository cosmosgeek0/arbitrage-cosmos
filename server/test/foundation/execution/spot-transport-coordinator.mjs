#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SPOT_OWNER_SEND_AUTHORITY_SCHEMA,
  SPOT_RISK_EVIDENCE_SCHEMA,
  SPOT_SIGNED_TEST_EVIDENCE_SCHEMA,
  deriveFlattenLeg as deriveExactFlattenLeg,
} from '../../../dist/foundation/execution/spotCore.js';
import {
  SPOT_TRANSPORT_COORDINATOR_SCHEMA,
  runSpotRecoveryTransportCoordinator,
  runSpotTransportCoordinator,
} from '../../../dist/foundation/execution/spotTransportCoordinator.js';
import {
  calculateM0SpotIntentDigest,
} from '../../../dist/foundation/execution/m0SpotLifecycleCard.js';
import { createSpotExecutionTicket } from '../../../dist/foundation/execution/spotTicket.js';
import {
  addSpotDecimals,
  multiplySpotDecimals,
  subtractSpotDecimals,
} from '../../../dist/foundation/exchange/binanceSpot/filters.js';

const NOW = 100_000;
const SYMBOL = 'TESTUSDT';
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
    correlationId: 'correlation-spot-transport-1',
    planId: 'plan-spot-transport-1',
    accountId: 'account-spot-transport-1',
    symbol: SYMBOL,
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'FOK',
    quantity: '0.05',
    price: '100',
    riskReferencePrice: '100',
    estimatedMaxLossQuote: '1',
    purpose: 'ENTRY',
    attempt: 0,
    createdAtMs: NOW - 1_000,
    expiresAtMs: NOW + 10_000,
    ...overrides,
  });
}

function riskEvidence(value, overrides = {}) {
  return {
    schema: SPOT_RISK_EVIDENCE_SCHEMA,
    verification: 'VERIFIED_BY_CANONICAL_RISK_OWNER',
    evidenceRevision: `risk-evidence-${value.ticketId}`,
    policyRevision: 'risk-policy-transport-1',
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
    observedAtMs: NOW - 500,
    validUntilMs: NOW + 9_000,
    killSwitchEngaged: false,
    realizedDailyLossQuote: '0',
    riskReduction: null,
    ...overrides,
  };
}

function signedTestEvidence(value, overrides = {}) {
  return {
    schema: SPOT_SIGNED_TEST_EVIDENCE_SCHEMA,
    evidenceId: `signed-test-${value.ticketId}`,
    status: 'ACCEPTED',
    ticketId: value.ticketId,
    termsDigest: value.termsDigest,
    clientOrderId: value.clientOrderId,
    filterSnapshotRevision: 'exchange-info-transport-1',
    observedAtMs: NOW - 250,
    createsVenueOrder: false,
    ...overrides,
  };
}

function ownerAuthority(value, overrides = {}) {
  return {
    schema: SPOT_OWNER_SEND_AUTHORITY_SCHEMA,
    authorizationId: `owner-authority-${value.ticketId}`,
    verification: 'VERIFIED_BY_CANONICAL_OWNER_AUTHORITY',
    ticketId: value.ticketId,
    termsDigest: value.termsDigest,
    clientOrderId: value.clientOrderId,
    maxOrderNotionalQuote: '10',
    confirmedAtMs: NOW - 200,
    expiresAtMs: NOW + 8_000,
    singleUse: true,
    ...overrides,
  };
}

function leg(value = ticket(), overrides = {}) {
  return {
    ticket: value,
    filterSnapshot: {
      revision: 'exchange-info-transport-1',
      observedAtMs: NOW - 600,
      filters: FILTERS,
    },
    nowMs: NOW,
    riskEvidence: riskEvidence(value),
    venueEvidence: {
      referencePrice: {
        state: 'SET',
        price: '100',
        providerTimestampMs: NOW - 700,
      },
      fallbackPrices: [],
      executionRules: [],
    },
    readiness: {
      backupReady: true,
      privateReadReady: true,
      totalFeeReserveQuote: '0.02',
    },
    signedTestEvidence: signedTestEvidence(value),
    ownerAuthority: ownerAuthority(value),
    ...overrides,
  };
}

function flattenLeg(quantity = '0.02', overrides = {}) {
  const value = ticket({
    correlationId: 'correlation-spot-transport-1',
    planId: 'plan-spot-transport-1',
    side: 'SELL',
    timeInForce: 'FOK',
    quantity,
    purpose: 'FLATTEN',
    attempt: 1,
  });
  return {
    ...leg(value, {
      riskEvidence: riskEvidence(value, {
        riskReduction: {
          basis: 'RECONCILED_SPOT_BASE_REDUCTION',
          positionSnapshotRevision: 'position-transport-1',
          reconciliationStatus: 'EXACT',
          side: 'SELL',
          availableBaseQuantity: quantity,
          attributableBaseQuantity: quantity,
          cumulativeFilledSellQuantity: '0',
          cumulativeAuthorizedLifecycleTurnoverQuote: '2',
          maximumAuthorizedLifecycleTurnoverQuote: '10',
          quantityStepSize: '0.001',
        },
      }),
    }),
    ...overrides,
  };
}

function coordinatorInput(entry = leg(), flatten = null, overrides = {}) {
  return {
    entry,
    flatten,
    baseAsset: 'TEST',
    quoteAsset: 'USDT',
    maximumGrossLifecycleTurnoverQuote: '10',
    totalFeeReserveQuote: '0.02',
    maximumResidualDustNotionalQuote: '0.01',
    exchangeBaseTolerance: '0.0001',
    baseBalanceBaseline: {
      revision: 'base-balance-before-entry-1',
      quantity: '1',
      observedAtMs: NOW - 1_100,
    },
    quoteBalanceBaseline: {
      revision: 'base-balance-before-entry-1',
      quantity: '100',
      tolerance: '0.01',
      observedAtMs: NOW - 1_100,
    },
    ...overrides,
  };
}

function observedFill(fillId, venueOrderId, quantity = '0.02') {
  return Object.freeze({
    fillId,
    venueOrderId,
    price: '100',
    quantity,
    quoteQuantity: multiplySpotDecimals('100', quantity),
    commission: '0',
    commissionAsset: 'USDT',
    occurredAtMs: NOW - 50,
  });
}

function exactFlatEvidenceFor(request, overrides = {}) {
  const observedQuoteQuantity =
    request.fillDerivedQuoteCashflow.direction === 'CREDIT'
      ? addSpotDecimals(
          request.baselineQuoteQuantity,
          request.fillDerivedQuoteCashflow.quantity,
        )
      : request.fillDerivedQuoteCashflow.direction === 'DEBIT'
        ? subtractSpotDecimals(
            request.baselineQuoteQuantity,
            request.fillDerivedQuoteCashflow.quantity,
          )
        : request.baselineQuoteQuantity;
  return Object.freeze({
    revision: 'flat-evidence-exact',
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
    observedQuoteQuantity,
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
    occurredAtMs: NOW,
    ...overrides,
  });
}

function admitted(overrides = {}) {
  return Object.freeze({
    sourceEnabled: true,
    killSwitchEngaged: false,
    allowedSymbols: Object.freeze([SYMBOL]),
    blockedSymbols: Object.freeze([]),
    recoveryAuthorizedUntilFlat: true,
    revision: 'spot-transport-controls-1',
    ...overrides,
  });
}

function reservationReceipt(authority, intent, overrides = {}) {
  return Object.freeze({
    schema: 'cosmos.foundation.spot-mutation-reservation.v1',
    action: intent.kind === 'FLATTEN' ? 'FLATTEN' : 'ENTRY',
    ticketId: authority.ticketId,
    termsDigest: authority.termsDigest,
    clientOrderId: authority.clientOrderId,
    intentDigest: calculateM0SpotIntentDigest(intent),
    durableAuthorityConsumed: true,
    canonicalOrderRequestAppended: true,
    dispatchClaimAvailable: true,
    replay: false,
    ...overrides,
  });
}

function cancelReservationReceipt(action, cancelTicket, intent, overrides = {}) {
  return Object.freeze({
    schema: 'cosmos.foundation.spot-cancel-reservation.v1',
    action,
    ticketId: cancelTicket.ticketId,
    termsDigest: cancelTicket.termsDigest,
    clientOrderId: cancelTicket.clientOrderId,
    intentDigest: calculateM0SpotIntentDigest(intent),
    durableAuthorityConsumed: true,
    canonicalCancelAttemptAppended: true,
    dispatchClaimAvailable: true,
    replay: false,
    ...overrides,
  });
}

function harness({
  admissions = [admitted(), admitted(), admitted(), admitted()],
  signedTestOutcomes = [{
    kind: 'ACKNOWLEDGED',
    venueOrderId: null,
    cumulativeFilledQuantity: '0',
  }],
  submitOutcomes = [{
    kind: 'AMBIGUOUS',
    reasonCode: 'VENUE_EXECUTION_STATUS_UNKNOWN',
    queryOriginalClientOrderId: ticket().clientOrderId,
    automaticRetry: false,
  }],
  queryOutcomes = [{
    kind: 'UNRESOLVED',
    reasonCode: 'VENUE_EXECUTION_STATUS_UNKNOWN',
  }],
  fillOutcomes = [],
  cancelOutcomes = [],
  flattenOutcomes = [],
  flatEvidence = null,
  ledgerOutcome = 'APPENDED',
  ledgerOutcomes = null,
  verifyEvidence = null,
  reserve = null,
  reserveCancel = null,
  derive = null,
} = {}) {
  const calls = {
    admission: [],
    signedTest: [],
    submit: [],
    query: [],
    fills: [],
    cancel: [],
    flatten: [],
    authority: [],
    cancelAuthority: [],
    verifier: [],
    ledger: [],
    flatEvidence: [],
    timeline: [],
  };
  const next = (values, name) => {
    assert.ok(values.length > 0, `unexpected ${name} call`);
    return values.shift();
  };
  const executionPort = {
    async signedTestOrder(intent) {
      calls.signedTest.push(intent);
      return next(signedTestOutcomes, 'signed test');
    },
    async submitLiveOrder(intent) {
      calls.submit.push(intent);
      calls.timeline.push('SUBMIT');
      return next(submitOutcomes, 'submit');
    },
    async queryByOriginalClientOrderId(intent) {
      calls.query.push(intent);
      return next(queryOutcomes, 'query');
    },
    async queryFills(intent) {
      calls.fills.push(intent);
      return next(fillOutcomes, 'fills');
    },
    async cancel(intent) {
      calls.cancel.push(intent);
      calls.timeline.push('CANCEL');
      return next(cancelOutcomes, 'cancel');
    },
    async flatten(intent) {
      calls.flatten.push(intent);
      calls.timeline.push('FLATTEN');
      return next(flattenOutcomes, 'flatten');
    },
  };
  return {
    calls,
    ports: {
      async readAdmission(symbol, action) {
        calls.admission.push({ symbol, action });
        return next(admissions, 'admission');
      },
      clock: Object.freeze({ nowMs: () => NOW }),
      executionPort,
      async verifySignedTestEvidence(intent, outcome, evidence) {
        calls.verifier.push({ intent, outcome, evidence });
        if (typeof verifyEvidence === 'function') {
          return verifyEvidence(intent, outcome, evidence);
        }
        return (
          outcome.kind === 'ACKNOWLEDGED' &&
          outcome.venueOrderId === null &&
          outcome.cumulativeFilledQuantity === '0' &&
          evidence?.status === 'ACCEPTED' &&
          evidence.createsVenueOrder === false &&
          evidence.ticketId === intent.ticketId &&
          evidence.termsDigest === intent.termsDigest &&
          evidence.clientOrderId === intent.clientOrderId &&
          evidence.filterSnapshotRevision ===
            intent.filterSnapshotRevision
        );
      },
      async reserveMutation(authority, intent) {
        calls.authority.push({ authority, intent });
        if (typeof reserve === 'function') {
          const reserved = await reserve(authority, intent);
          if (reserved === false || reserved === null) return null;
          if (reserved !== true) return reserved;
        }
        return reservationReceipt(authority, intent);
      },
      async reserveCancel(action, cancelTicket, intent) {
        calls.cancelAuthority.push({ action, ticket: cancelTicket, intent });
        if (typeof reserveCancel === 'function') {
          const reserved = await reserveCancel(
            action,
            cancelTicket,
            intent,
          );
          if (reserved === false || reserved === null) return null;
          if (reserved !== true) return reserved;
        }
        return cancelReservationReceipt(action, cancelTicket, intent);
      },
      deriveFlattenLeg(request) {
        if (typeof derive === 'function') return derive(request);
        const exact = deriveExactFlattenLeg({
          ...request,
          previousFlattenAttempts: request.previousFlattenAttempts.map(
            (attempt) => ({
              ticket: attempt.ticket,
              venueOrderId: attempt.venueOrderId,
              authoritativelyAbsent: attempt.authoritativelyAbsent,
              fills: attempt.fills,
            }),
          ),
          quantityStepSize: '0.001',
          price: '100',
          riskReferencePrice: '100',
          estimatedMaxLossQuote: '1',
          createdAtMs: NOW - 1_000,
          expiresAtMs: NOW + 10_000,
        });
        if (exact.ticket === null) return null;
        return leg(exact.ticket, {
          riskEvidence: riskEvidence(exact.ticket, {
            riskReduction: {
              basis: 'RECONCILED_SPOT_BASE_REDUCTION',
              positionSnapshotRevision: `position-${request.attempt}`,
              reconciliationStatus: 'EXACT',
              side: 'SELL',
              availableBaseQuantity: exact.sellQuantity,
              attributableBaseQuantity: exact.attributableBaseQuantity,
              cumulativeFilledSellQuantity:
                exact.cumulativeFilledSellQuantity,
              cumulativeAuthorizedLifecycleTurnoverQuote:
                exact.authorizedFilledLifecycleTurnoverQuote,
              maximumAuthorizedLifecycleTurnoverQuote:
                exact.maximumAuthorizedLifecycleTurnoverQuote,
              quantityStepSize: exact.quantityStepSize,
            },
          }),
          signedTestEvidence: null,
        });
      },
      async appendLedger(intent) {
        calls.ledger.push(intent);
        calls.timeline.push(
          `LEDGER:${intent.data.eventKind}:${intent.data.correlation.attemptKind}`,
        );
        if (Array.isArray(ledgerOutcomes)) {
          return next(ledgerOutcomes, 'ledger append');
        }
        if (typeof ledgerOutcomes === 'function') {
          return ledgerOutcomes(intent);
        }
        return ledgerOutcome;
      },
      async readFlatEvidence(request) {
        calls.flatEvidence.push(request);
        return typeof flatEvidence === 'function'
          ? flatEvidence(request)
          : flatEvidence;
      },
    },
  };
}

test('schema is explicit while the coordinator remains a direct-only, never-live export', () => {
  assert.equal(
    SPOT_TRANSPORT_COORDINATOR_SCHEMA,
    'COSMOS_SPOT_TRANSPORT_COORDINATOR_V1',
  );
  const barrel = readFileSync(
    new URL('../../../src/foundation/execution/index.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(barrel, /spotTransportCoordinator/);

  const source = readFileSync(
    new URL(
      '../../../src/foundation/execution/spotTransportCoordinator.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /\bprocess\.env\b|\bfetch\s*\(|node:https?|node:net|node:tls|WebSocket|XMLHttpRequest/,
  );
  assert.doesNotMatch(
    source,
    /\bwithdraw(?:al)?\b|\btransfer\b|\bloan\b/i,
  );
});

test('unknown kill switch dominates before any hostile caller input is read', async () => {
  const { calls, ports } = harness({
    admissions: [
      admitted({ killSwitchEngaged: null }),
    ],
  });
  let reads = 0;
  const hostile = new Proxy({}, {
    get() {
      reads += 1;
      throw new Error('coordinator read hostile input behind closed controls');
    },
  });

  const result = await runSpotTransportCoordinator(SYMBOL, hostile, ports);

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.liveExportReachable, false);
  assert.equal(reads, 0);
  assert.equal(calls.admission.length, 1);
  assert.equal(calls.signedTest.length, 0);
  assert.equal(calls.submit.length, 0);
  assert.equal(calls.query.length, 0);
  assert.equal(calls.cancel.length, 0);
  assert.equal(calls.flatten.length, 0);
});

test('empty allowlist dominates before any mutation or caller input access', async () => {
  const { calls, ports } = harness({
    admissions: [
      admitted({ allowedSymbols: Object.freeze([]) }),
    ],
  });
  let reads = 0;
  const hostile = new Proxy({}, {
    get() {
      reads += 1;
      throw new Error('coordinator read hostile input behind empty allowlist');
    },
  });

  const result = await runSpotTransportCoordinator(SYMBOL, hostile, ports);

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.liveExportReachable, false);
  assert.equal(reads, 0);
  assert.equal(calls.signedTest.length, 0);
  assert.equal(calls.submit.length, 0);
  assert.equal(calls.query.length, 0);
  assert.equal(calls.cancel.length, 0);
  assert.equal(calls.flatten.length, 0);
});

test('a plain spread clone with one extra ticket field is non-canonical and has zero mutation effects', async () => {
  const canonicalEntry = leg();
  const hostileClone = Object.freeze({
    ...canonicalEntry,
    ticket: Object.freeze({
      ...canonicalEntry.ticket,
      unexpectedAuthorityHint: 'FORGED',
    }),
  });
  const { calls, ports } = harness();

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(hostileClone),
    ports,
  );

  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.reasonCodes, ['ENTRY_TICKET_NOT_CANONICAL']);
  assert.equal(result.liveExportReachable, false);
  assert.equal(calls.admission.length, 1);
  assert.equal(calls.signedTest.length, 0);
  assert.equal(calls.authority.length, 0);
  assert.equal(calls.ledger.length, 0);
  assert.equal(calls.submit.length, 0);
  assert.equal(calls.query.length, 0);
  assert.equal(calls.cancel.length, 0);
  assert.equal(calls.flatten.length, 0);
});

test('controls are re-read after signed test and a newly engaged kill switch prevents submit', async () => {
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted({ killSwitchEngaged: true }),
    ],
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(),
    ports,
  );

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.liveExportReachable, false);
  assert.equal(calls.signedTest.length, 1);
  assert.equal(calls.submit.length, 0);
  assert.equal(calls.authority.length, 0);
});

test('post-test allowlist removal and blocklist both dominate before authority consumption', async () => {
  const closedAdmissions = [
    admitted({ allowedSymbols: Object.freeze([]) }),
    admitted({ blockedSymbols: Object.freeze([SYMBOL]) }),
  ];

  for (const closedAdmission of closedAdmissions) {
    const { calls, ports } = harness({
      admissions: [admitted(), closedAdmission],
    });
    const result = await runSpotTransportCoordinator(
      SYMBOL,
      coordinatorInput(),
      ports,
    );

    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.liveExportReachable, false);
    assert.equal(calls.signedTest.length, 1);
    assert.equal(calls.authority.length, 0);
    assert.equal(calls.submit.length, 0);
  }
});

test('verifier rejection blocks before owner authority, ledger, or submit', async () => {
  const { calls, ports } = harness({
    verifyEvidence: () => false,
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(),
    ports,
  );

  assert.equal(result.status, 'BLOCKED');
  assert.ok(
    result.reasonCodes.includes('SIGNED_TEST_EVIDENCE_NOT_VERIFIED'),
  );
  assert.equal(calls.signedTest.length, 1);
  assert.equal(calls.verifier.length, 1);
  assert.equal(calls.authority.length, 0);
  assert.equal(calls.ledger.length, 0);
  assert.equal(calls.submit.length, 0);
});

test('kill flip after atomic authority consumption burns authority and performs zero submit', async () => {
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted(),
      admitted({ killSwitchEngaged: true }),
    ],
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(),
    ports,
  );

  assert.equal(result.status, 'BLOCKED');
  assert.ok(
    result.reasonCodes.includes(
      'ENTRY_AUTHORITY_CONSUMED_SEND_NOW_BLOCKED',
    ),
  );
  assert.equal(calls.verifier.length, 1);
  assert.equal(calls.authority.length, 1);
  assert.equal(calls.ledger.length, 1);
  assert.equal(calls.ledger[0].status, 'SUBMITTING');
  assert.equal(calls.submit.length, 0);
});

test('mutation attempt ledger must acknowledge durability before any submit', async () => {
  const { calls, ports } = harness({
    ledgerOutcome: 'CONFLICT',
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(),
    ports,
  );

  assert.equal(result.status, 'BLOCKED');
  assert.ok(
    result.reasonCodes.includes('ENTRY_ATTEMPT_LEDGER_NOT_DURABLE'),
  );
  assert.equal(calls.authority.length, 1);
  assert.equal(calls.ledger.length, 1);
  assert.equal(calls.submit.length, 0);
  assert.deepEqual(calls.timeline, ['LEDGER:ATTEMPT:ORDER']);
});

test('reservation must bind the exact canonical intent digest and atomic durability facts', async () => {
  const malformedReceipts = [
    { intentDigest: `sha256:${'0'.repeat(64)}` },
    { durableAuthorityConsumed: false },
    { canonicalOrderRequestAppended: false },
    { dispatchClaimAvailable: false },
    { replay: true },
    { action: 'FLATTEN' },
  ];

  for (const overrides of malformedReceipts) {
    const { calls, ports } = harness({
      reserve: (authority, intent) =>
        reservationReceipt(authority, intent, overrides),
    });

    const result = await runSpotTransportCoordinator(
      SYMBOL,
      coordinatorInput(),
      ports,
    );

    assert.equal(result.status, 'BLOCKED');
    assert.deepEqual(
      result.reasonCodes,
      ['ENTRY_MUTATION_NOT_ATOMICALLY_RESERVED'],
    );
    assert.equal(calls.authority.length, 1);
    assert.equal(
      calculateM0SpotIntentDigest(calls.authority[0].intent),
      reservationReceipt(
        calls.authority[0].authority,
        calls.authority[0].intent,
      ).intentDigest,
    );
    assert.equal(calls.ledger.length, 0);
    assert.equal(calls.submit.length, 0);
    assert.equal(calls.query.length, 0);
  }
});

test('concurrent runs share atomic authority consumption and submit at most once', async () => {
  const value = ticket();
  let consumed = false;
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
    ],
    signedTestOutcomes: [
      {
        kind: 'ACKNOWLEDGED',
        venueOrderId: null,
        cumulativeFilledQuantity: '0',
      },
      {
        kind: 'ACKNOWLEDGED',
        venueOrderId: null,
        cumulativeFilledQuantity: '0',
      },
    ],
    submitOutcomes: [{
      kind: 'AMBIGUOUS',
      reasonCode: 'VENUE_EXECUTION_STATUS_UNKNOWN',
      queryOriginalClientOrderId: value.clientOrderId,
      automaticRetry: false,
    }],
    queryOutcomes: [{
      kind: 'UNRESOLVED',
      reasonCode: 'VENUE_EXECUTION_STATUS_UNKNOWN',
    }],
    reserve: () => {
      if (consumed) return false;
      consumed = true;
      return true;
    },
  });
  const input = coordinatorInput(leg(value));

  const results = await Promise.all([
    runSpotTransportCoordinator(SYMBOL, input, ports),
    runSpotTransportCoordinator(SYMBOL, input, ports),
  ]);

  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ['BLOCKED', 'RECOVERY_REQUIRED'],
  );
  assert.equal(calls.signedTest.length, 2);
  assert.equal(calls.verifier.length, 2);
  assert.equal(calls.authority.length, 2);
  assert.equal(calls.ledger.length, 1);
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.query.length, 1);
});

test('duplicate ledger fence makes a second owner authorization query-only for the same ticket', async () => {
  const value = ticket();
  const inputA = coordinatorInput(
    leg(value, {
      ownerAuthority: ownerAuthority(value, {
        authorizationId: 'owner-authority-concurrent-a',
      }),
    }),
  );
  const inputB = coordinatorInput(
    leg(value, {
      ownerAuthority: ownerAuthority(value, {
        authorizationId: 'owner-authority-concurrent-b',
      }),
    }),
  );
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
    ],
    signedTestOutcomes: [
      {
        kind: 'ACKNOWLEDGED',
        venueOrderId: null,
        cumulativeFilledQuantity: '0',
      },
      {
        kind: 'ACKNOWLEDGED',
        venueOrderId: null,
        cumulativeFilledQuantity: '0',
      },
    ],
    ledgerOutcomes: ['APPENDED', 'DUPLICATE'],
    submitOutcomes: [{
      kind: 'AMBIGUOUS',
      reasonCode: 'VENUE_EXECUTION_STATUS_UNKNOWN',
      queryOriginalClientOrderId: value.clientOrderId,
      automaticRetry: false,
    }],
    queryOutcomes: [
      {
        kind: 'UNRESOLVED',
        reasonCode: 'VENUE_EXECUTION_STATUS_UNKNOWN',
      },
      {
        kind: 'UNRESOLVED',
        reasonCode: 'VENUE_EXECUTION_STATUS_UNKNOWN',
      },
    ],
    reserve: () => true,
  });

  const results = await Promise.all([
    runSpotTransportCoordinator(SYMBOL, inputA, ports),
    runSpotTransportCoordinator(SYMBOL, inputB, ports),
  ]);

  assert.ok(
    results.some((result) =>
      result.reasonCodes.includes('ENTRY_ATTEMPT_ALREADY_EXISTS_NO_RESEND')),
  );
  assert.equal(calls.signedTest.length, 2);
  assert.equal(calls.verifier.length, 2);
  assert.equal(calls.authority.length, 2);
  assert.notEqual(
    calls.authority[0].authority.authorizationId,
    calls.authority[1].authority.authorizationId,
  );
  assert.equal(calls.ledger.length, 2);
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.query.length, 2);
  assert.ok(
    calls.query.every(
      (intent) => intent.originalClientOrderId === value.clientOrderId,
    ),
  );
});

test('signed test must acknowledge no venue order and zero fill before owner authority is consumed', async () => {
  const disallowed = [
    {
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'unexpected-venue-order',
      cumulativeFilledQuantity: '0',
    },
    {
      kind: 'ACKNOWLEDGED',
      venueOrderId: null,
      cumulativeFilledQuantity: '0.001',
    },
    {
      kind: 'AMBIGUOUS',
      reasonCode: 'SIGNED_TEST_STATUS_UNKNOWN',
      queryOriginalClientOrderId: ticket().clientOrderId,
      automaticRetry: false,
    },
  ];

  for (const signedTestOutcome of disallowed) {
    const { calls, ports } = harness({
      signedTestOutcomes: [signedTestOutcome],
    });
    const result = await runSpotTransportCoordinator(
      SYMBOL,
      coordinatorInput(),
      ports,
    );

    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.liveExportReachable, false);
    assert.equal(calls.signedTest.length, 1);
    assert.equal(calls.authority.length, 0);
    assert.equal(calls.submit.length, 0);
  }
});

test('ambiguous submit is consumed once then queried by the original client ID without resubmission', async () => {
  const value = ticket();
  const { calls, ports } = harness({
    submitOutcomes: [{
      kind: 'AMBIGUOUS',
      reasonCode: 'VENUE_EXECUTION_STATUS_UNKNOWN',
      queryOriginalClientOrderId: value.clientOrderId,
      automaticRetry: false,
    }],
    queryOutcomes: [{
      kind: 'UNRESOLVED',
      reasonCode: 'VENUE_EXECUTION_STATUS_UNKNOWN',
    }],
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(value)),
    ports,
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.equal(result.liveExportReachable, false);
  assert.equal(calls.signedTest.length, 1);
  assert.equal(calls.authority.length, 1);
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.query.length, 1);
  assert.equal(calls.query[0].originalClientOrderId, value.clientOrderId);
  assert.equal(calls.cancel.length, 0);
  assert.equal(calls.flatten.length, 0);
  assert.equal(calls.submit[0].automaticRetry, false);
});

test('venue-rejected submit is still query-before-conclusion and never reuses authority', async () => {
  const value = ticket();
  const { calls, ports } = harness({
    submitOutcomes: [{
      kind: 'REJECTED',
      venueCode: -2010,
      reasonCode: 'VENUE_REJECTED_ENTRY',
    }],
    queryOutcomes: [{
      kind: 'UNRESOLVED',
      reasonCode: 'VENUE_EXECUTION_STATUS_UNKNOWN',
    }],
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(value)),
    ports,
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.deepEqual(result.reasonCodes, ['SOURCE_QUERY_UNRESOLVED']);
  assert.equal(calls.authority.length, 1);
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.query.length, 1);
  assert.equal(calls.query[0].originalClientOrderId, value.clientOrderId);
  assert.equal(calls.cancel.length, 0);
  assert.equal(calls.flatten.length, 0);
});

test('authoritative absence after an ambiguous submit cannot restore consumed send authority', async () => {
  const value = ticket();
  const { calls, ports } = harness({
    submitOutcomes: [{
      kind: 'AMBIGUOUS',
      reasonCode: 'VENUE_EXECUTION_STATUS_UNKNOWN',
      queryOriginalClientOrderId: value.clientOrderId,
      automaticRetry: false,
    }],
    queryOutcomes: [{
      kind: 'AUTHORITATIVE_NOT_FOUND',
      originalClientOrderId: value.clientOrderId,
    }],
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(value)),
    ports,
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.ok(
    result.reasonCodes.includes(
      'SUBMIT_AUTHORITY_CONSUMED_ORDER_PROVEN_ABSENT',
    ),
  );
  assert.equal(result.liveExportReachable, false);
  assert.equal(calls.authority.length, 1);
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.query.length, 1);
  assert.equal(calls.cancel.length, 0);
  assert.equal(calls.flatten.length, 0);
});

test('cancel ambiguity is queried and never retries cancel or the original submit', async () => {
  const value = ticket();
  const { calls, ports } = harness({
    submitOutcomes: [{
      kind: 'AMBIGUOUS',
      reasonCode: 'VENUE_EXECUTION_STATUS_UNKNOWN',
      queryOriginalClientOrderId: value.clientOrderId,
      automaticRetry: false,
    }],
    queryOutcomes: [
      {
        kind: 'FOUND',
        status: 'PARTIALLY_FILLED',
        venueOrderId: 'venue-order-entry-1',
        cumulativeFilledQuantity: '0.02',
      },
      {
        kind: 'FOUND',
        status: 'CANCELED',
        venueOrderId: 'venue-order-entry-1',
        cumulativeFilledQuantity: '0.02',
      },
    ],
    cancelOutcomes: [{
      kind: 'AMBIGUOUS',
      reasonCode: 'CANCEL_STATUS_UNKNOWN',
      queryOriginalClientOrderId: value.clientOrderId,
      automaticRetry: false,
    }],
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(value)),
    ports,
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.equal(result.liveExportReachable, false);
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.cancel.length, 1);
  assert.equal(calls.query.length, 2);
  assert.ok(
    calls.query.every(
      (intent) => intent.originalClientOrderId === value.clientOrderId,
    ),
  );
  assert.equal(calls.flatten.length, 0);
});

test('venue-rejected cancel is followed by exact order query and no cancel retry', async () => {
  const value = ticket();
  const { calls, ports } = harness({
    submitOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-cancel-rejected',
      cumulativeFilledQuantity: '0.02',
    }],
    queryOutcomes: [
      {
        kind: 'FOUND',
        status: 'PARTIALLY_FILLED',
        venueOrderId: 'venue-order-cancel-rejected',
        cumulativeFilledQuantity: '0.02',
      },
      {
        kind: 'FOUND',
        status: 'CANCELED',
        venueOrderId: 'venue-order-cancel-rejected',
        cumulativeFilledQuantity: '0.02',
      },
    ],
    cancelOutcomes: [{
      kind: 'REJECTED',
      venueCode: -2011,
      reasonCode: 'VENUE_REJECTED_CANCEL',
    }],
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(value)),
    ports,
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.deepEqual(result.reasonCodes, ['SOURCE_FILL_QUERY_UNRESOLVED']);
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.cancel.length, 1);
  assert.equal(calls.query.length, 2);
  assert.ok(
    calls.query.every(
      (intent) => intent.originalClientOrderId === value.clientOrderId,
    ),
  );
  assert.equal(calls.flatten.length, 0);
});

test('one signed test gates entry while flatten is separately authorized and incomplete flat evidence never reports flat', async () => {
  const entryValue = ticket();
  const flatten = flattenLeg();
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
    ],
    submitOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-entry-1',
      cumulativeFilledQuantity: '0.02',
    }],
    queryOutcomes: [
      {
        kind: 'FOUND',
        status: 'PARTIALLY_FILLED',
        venueOrderId: 'venue-order-entry-1',
        cumulativeFilledQuantity: '0.02',
      },
      {
        kind: 'FOUND',
        status: 'CANCELED',
        venueOrderId: 'venue-order-entry-1',
        cumulativeFilledQuantity: '0.02',
      },
      {
        kind: 'FOUND',
        status: 'FILLED',
        venueOrderId: 'venue-order-flatten-1',
        cumulativeFilledQuantity: '0.02',
      },
    ],
    cancelOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-entry-1',
      cumulativeFilledQuantity: '0.02',
    }],
    flattenOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-flatten-1',
      cumulativeFilledQuantity: '0.02',
    }],
    fillOutcomes: [
      [observedFill('fill-entry-1', 'venue-order-entry-1')],
      [observedFill('fill-flatten-1', 'venue-order-flatten-1')],
    ],
    flatEvidence: null,
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(entryValue), flatten),
    ports,
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.equal(result.liveExportReachable, false);
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.cancel.length, 1);
  assert.equal(calls.flatten.length, 1);
  assert.equal(calls.signedTest.length, 1);
  assert.equal(calls.verifier.length, 1);
  assert.equal(calls.authority.length, 2);
  assert.equal(calls.query.length, 3);
  assert.deepEqual(
    calls.query.map((intent) => intent.originalClientOrderId),
    [
      entryValue.clientOrderId,
      entryValue.clientOrderId,
      flatten.ticket.clientOrderId,
    ],
  );
  assert.equal(calls.flatten[0].automaticRetry, false);
  assert.equal(calls.flatten[0].sourceTicketId, entryValue.ticketId);
  assert.equal(calls.flatten[0].flattenTicket.ticketId, flatten.ticket.ticketId);
  assert.equal(result.lifecycle?.lifecycle, 'FLAT');
});

test('flatten requires the exact durable recovery-until-flat covenant', async () => {
  const entryValue = ticket();
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted(),
      admitted(),
      admitted({
        killSwitchEngaged: true,
        recoveryAuthorizedUntilFlat: false,
      }),
    ],
    submitOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-entry-2',
      cumulativeFilledQuantity: '0.02',
    }],
    queryOutcomes: [{
      kind: 'FOUND',
      status: 'PARTIALLY_FILLED',
      venueOrderId: 'venue-order-entry-2',
      cumulativeFilledQuantity: '0.02',
    }, {
      kind: 'FOUND',
      status: 'CANCELED',
      venueOrderId: 'venue-order-entry-2',
      cumulativeFilledQuantity: '0.02',
    }],
    cancelOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-entry-2',
      cumulativeFilledQuantity: '0.02',
    }],
    fillOutcomes: [[
      observedFill('fill-entry-2', 'venue-order-entry-2'),
    ]],
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(entryValue), flattenLeg()),
    ports,
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.equal(result.liveExportReachable, false);
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.cancel.length, 1);
  assert.equal(calls.flatten.length, 0);
  assert.deepEqual(
    result.reasonCodes,
    ['RECOVERY_COVENANT_NOT_ACTIVE', 'FLATTEN_BLOCKED_WITH_RESIDUAL'],
  );
  assert.equal(calls.admission.length, 4);
  assert.equal(calls.authority.length, 1);
  assert.notEqual(result.status, 'FLAT_RECONCILED');
});

test('kill stays engaged while the exact recovery covenant permits only the separately reserved flatten', async () => {
  const entryValue = ticket();
  const flatten = flattenLeg();
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted({ killSwitchEngaged: true }),
    ],
    submitOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-entry-flatten-kill',
      cumulativeFilledQuantity: '0.02',
    }],
    queryOutcomes: [{
      kind: 'FOUND',
      status: 'PARTIALLY_FILLED',
      venueOrderId: 'venue-order-entry-flatten-kill',
      cumulativeFilledQuantity: '0.02',
    }, {
      kind: 'FOUND',
      status: 'CANCELED',
      venueOrderId: 'venue-order-entry-flatten-kill',
      cumulativeFilledQuantity: '0.02',
    }, {
      kind: 'UNRESOLVED',
      reasonCode: 'FLATTEN_EXECUTION_STATUS_UNKNOWN',
    }],
    cancelOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-entry-flatten-kill',
      cumulativeFilledQuantity: '0.02',
    }],
    flattenOutcomes: [{
      kind: 'REJECTED',
      venueCode: -2010,
      reasonCode: 'VENUE_REJECTED_FLATTEN',
    }],
    fillOutcomes: [[
      observedFill(
        'fill-entry-flatten-kill',
        'venue-order-entry-flatten-kill',
      ),
    ]],
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(entryValue), flatten),
    ports,
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.deepEqual(
    result.reasonCodes,
    ['FLATTEN_QUERY_UNRESOLVED_NO_RESUBMIT'],
  );
  assert.equal(calls.admission.length, 6);
  assert.equal(calls.signedTest.length, 1);
  assert.equal(calls.verifier.length, 1);
  assert.equal(calls.authority.length, 2);
  assert.equal(calls.ledger.length, 3);
  assert.equal(calls.flatten.length, 1);
  assert.equal(calls.query.length, 3);
  assert.equal(
    calls.query[2].originalClientOrderId,
    flatten.ticket.clientOrderId,
  );
});

test('duplicate flatten attempt fence performs query-only recovery and zero flatten mutation', async () => {
  const entryValue = ticket();
  const flatten = flattenLeg();
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
    ],
    ledgerOutcomes: ['APPENDED', 'APPENDED', 'DUPLICATE'],
    submitOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-entry-flatten-duplicate',
      cumulativeFilledQuantity: '0.02',
    }],
    queryOutcomes: [
      {
        kind: 'FOUND',
        status: 'PARTIALLY_FILLED',
        venueOrderId: 'venue-order-entry-flatten-duplicate',
        cumulativeFilledQuantity: '0.02',
      },
      {
        kind: 'FOUND',
        status: 'CANCELED',
        venueOrderId: 'venue-order-entry-flatten-duplicate',
        cumulativeFilledQuantity: '0.02',
      },
      {
        kind: 'UNRESOLVED',
        reasonCode: 'PRIOR_FLATTEN_STATUS_UNKNOWN',
      },
    ],
    cancelOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-entry-flatten-duplicate',
      cumulativeFilledQuantity: '0.02',
    }],
    fillOutcomes: [[
      observedFill(
        'fill-entry-flatten-duplicate',
        'venue-order-entry-flatten-duplicate',
      ),
    ]],
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(entryValue), flatten),
    ports,
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.ok(
    result.reasonCodes.includes(
      'FLATTEN_ATTEMPT_ALREADY_EXISTS_NO_RESEND',
    ),
  );
  assert.equal(calls.authority.length, 2);
  assert.equal(calls.ledger.length, 3);
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.cancel.length, 1);
  assert.equal(calls.flatten.length, 0);
  assert.equal(calls.query.length, 3);
  assert.equal(
    calls.query[2].originalClientOrderId,
    flatten.ticket.clientOrderId,
  );
});

test('ambiguous flatten is queried by its own client ID and never resubmitted', async () => {
  const entryValue = ticket();
  const flatten = flattenLeg();
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
    ],
    submitOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-entry-3',
      cumulativeFilledQuantity: '0.02',
    }],
    queryOutcomes: [
      {
        kind: 'FOUND',
        status: 'PARTIALLY_FILLED',
        venueOrderId: 'venue-order-entry-3',
        cumulativeFilledQuantity: '0.02',
      },
      {
        kind: 'FOUND',
        status: 'CANCELED',
        venueOrderId: 'venue-order-entry-3',
        cumulativeFilledQuantity: '0.02',
      },
      {
        kind: 'UNRESOLVED',
        reasonCode: 'FLATTEN_EXECUTION_STATUS_UNKNOWN',
      },
    ],
    cancelOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-entry-3',
      cumulativeFilledQuantity: '0.02',
    }],
    flattenOutcomes: [{
      kind: 'AMBIGUOUS',
      reasonCode: 'FLATTEN_EXECUTION_STATUS_UNKNOWN',
      queryOriginalClientOrderId: flatten.ticket.clientOrderId,
      automaticRetry: false,
    }],
    fillOutcomes: [[
      observedFill('fill-entry-3', 'venue-order-entry-3'),
    ]],
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(entryValue), flatten),
    ports,
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.ok(
    result.reasonCodes.includes('FLATTEN_QUERY_UNRESOLVED_NO_RESUBMIT'),
  );
  assert.equal(result.liveExportReachable, false);
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.flatten.length, 1);
  assert.equal(calls.query.length, 3);
  assert.equal(
    calls.query[2].originalClientOrderId,
    flatten.ticket.clientOrderId,
  );
});

test('nonterminal flatten gets one cancel then query reconciliation with no mutation retry', async () => {
  const entryValue = ticket();
  const flatten = flattenLeg();
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
    ],
    submitOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: 'venue-order-entry-4',
      cumulativeFilledQuantity: '0.02',
    }],
    queryOutcomes: [
      {
        kind: 'FOUND',
        status: 'PARTIALLY_FILLED',
        venueOrderId: 'venue-order-entry-4',
        cumulativeFilledQuantity: '0.02',
      },
      {
        kind: 'FOUND',
        status: 'CANCELED',
        venueOrderId: 'venue-order-entry-4',
        cumulativeFilledQuantity: '0.02',
      },
      {
        kind: 'FOUND',
        status: 'PARTIALLY_FILLED',
        venueOrderId: 'venue-order-flatten-4',
        cumulativeFilledQuantity: '0.01',
      },
      {
        kind: 'FOUND',
        status: 'CANCELED',
        venueOrderId: 'venue-order-flatten-4',
        cumulativeFilledQuantity: '0.02',
      },
    ],
    cancelOutcomes: [
      {
        kind: 'ACKNOWLEDGED',
        venueOrderId: 'venue-order-entry-4',
        cumulativeFilledQuantity: '0.02',
      },
      {
        kind: 'AMBIGUOUS',
        reasonCode: 'FLATTEN_CANCEL_STATUS_UNKNOWN',
        queryOriginalClientOrderId: flatten.ticket.clientOrderId,
        automaticRetry: false,
      },
    ],
    flattenOutcomes: [{
      kind: 'AMBIGUOUS',
      reasonCode: 'FLATTEN_EXECUTION_STATUS_UNKNOWN',
      queryOriginalClientOrderId: flatten.ticket.clientOrderId,
      automaticRetry: false,
    }],
    fillOutcomes: [
      [observedFill('fill-entry-4', 'venue-order-entry-4')],
      [observedFill('fill-flatten-4', 'venue-order-flatten-4')],
    ],
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(entryValue), flatten),
    ports,
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.equal(result.liveExportReachable, false);
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.flatten.length, 1);
  assert.equal(calls.cancel.length, 2);
  assert.equal(calls.query.length, 4);
  assert.equal(
    calls.cancel[1].originalClientOrderId,
    flatten.ticket.clientOrderId,
  );
  assert.equal(calls.cancel[1].automaticRetry, false);
  assert.equal(
    calls.query[3].originalClientOrderId,
    flatten.ticket.clientOrderId,
  );
});

test('EXPIRED_IN_MATCH is terminal and can reconcile an exact-flat zero-fill order', async () => {
  const entryValue = ticket();
  const venueOrderId = 'venue-order-expired-in-match';
  const { calls, ports } = harness({
    submitOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId,
      cumulativeFilledQuantity: '0',
    }],
    queryOutcomes: [{
      kind: 'FOUND',
      status: 'EXPIRED_IN_MATCH',
      venueOrderId,
      cumulativeFilledQuantity: '0',
    }],
    fillOutcomes: [[]],
    flatEvidence: (request) => exactFlatEvidenceFor(request, {
      revision: 'flat-evidence-expired-in-match',
    }),
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(entryValue)),
    ports,
  );

  assert.equal(result.status, 'FLAT_RECONCILED', JSON.stringify(result));
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.lifecycle?.lifecycle, 'FLAT');
  assert.equal(result.liveExportReachable, false);
  assert.equal(result.executionAuthority, 'NONE');
  assert.equal(result.externalActionAuthorization, 'NONE');
  assert.equal(calls.query.length, 1);
  assert.equal(calls.cancel.length, 0);
  assert.equal(calls.flatten.length, 0);
  assert.equal(calls.fills.length, 1);
  assert.equal(calls.fills[0].originalClientOrderId, entryValue.clientOrderId);
  assert.equal(calls.fills[0].venueOrderId, venueOrderId);
  assert.equal(calls.flatEvidence.length, 1);
  assert.equal(calls.ledger.at(-1).status, 'EXACT');
});

test('only complete authoritative fills plus matched ledger evidence can report exact flat', async () => {
  const entryValue = ticket();
  const flatten = flattenLeg('0.05');
  const sourceFill = Object.freeze({
    fillId: 'fill-entry-exact-1',
    venueOrderId: 'venue-order-entry-exact-1',
    price: '100',
    quantity: '0.05',
    quoteQuantity: '5',
    commission: '0',
    commissionAsset: 'USDT',
    occurredAtMs: NOW - 100,
  });
  const flattenFill = Object.freeze({
    fillId: 'fill-flatten-exact-1',
    venueOrderId: 'venue-order-flatten-exact-1',
    price: '100',
    quantity: '0.05',
    quoteQuantity: '5',
    commission: '0',
    commissionAsset: 'USDT',
    occurredAtMs: NOW - 50,
  });
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
    ],
    submitOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: sourceFill.venueOrderId,
      cumulativeFilledQuantity: sourceFill.quantity,
    }],
    queryOutcomes: [
      {
        kind: 'FOUND',
        status: 'FILLED',
        venueOrderId: sourceFill.venueOrderId,
        cumulativeFilledQuantity: sourceFill.quantity,
      },
      {
        kind: 'FOUND',
        status: 'FILLED',
        venueOrderId: flattenFill.venueOrderId,
        cumulativeFilledQuantity: flattenFill.quantity,
      },
    ],
    flattenOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: flattenFill.venueOrderId,
      cumulativeFilledQuantity: flattenFill.quantity,
    }],
    fillOutcomes: [[sourceFill], [flattenFill]],
    flatEvidence: (request) => exactFlatEvidenceFor(request, {
      revision: 'flat-evidence-exact-1',
    }),
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(entryValue), flatten),
    ports,
  );

  assert.equal(
    result.status,
    'FLAT_RECONCILED',
    JSON.stringify(result),
  );
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.lifecycle?.lifecycle, 'FLAT');
  assert.equal(result.liveExportReachable, false);
  assert.equal(result.executionAuthority, 'NONE');
  assert.equal(result.externalActionAuthorization, 'NONE');
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.flatten.length, 1);
  assert.equal(calls.admission.length, 6);
  assert.equal(calls.signedTest.length, 1);
  assert.equal(calls.verifier.length, 1);
  assert.equal(calls.fills.length, 2);
  assert.equal(calls.flatEvidence.length, 1);
  assert.equal(calls.ledger.length, 3);
  assert.equal(calls.ledger[0].status, 'SUBMITTING');
  assert.equal(calls.ledger.at(-1).status, 'EXACT');
  assert.deepEqual(calls.timeline, [
    'LEDGER:ATTEMPT:ORDER',
    'SUBMIT',
    'LEDGER:ATTEMPT:FLATTEN',
    'FLATTEN',
    'LEDGER:RECONCILIATION:FLATTEN',
  ]);
});

test('base position can reconcile exactly while third-asset fee economics remain explicitly unmeasured', async () => {
  const entryValue = ticket();
  const sourceFill = Object.freeze({
    fillId: 'fill-entry-third-asset-fee',
    venueOrderId: 'venue-order-entry-third-asset-fee',
    price: '100',
    quantity: '0.05',
    quoteQuantity: '5',
    commission: '0.001',
    commissionAsset: 'TEST',
    occurredAtMs: NOW - 100,
  });
  const flattenFill = Object.freeze({
    fillId: 'fill-flatten-third-asset-fee',
    venueOrderId: 'venue-order-flatten-third-asset-fee',
    price: '100',
    quantity: '0.049',
    quoteQuantity: '4.9',
    commission: '0.0005',
    commissionAsset: 'BNB',
    occurredAtMs: NOW - 50,
  });
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
    ],
    submitOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: sourceFill.venueOrderId,
      cumulativeFilledQuantity: sourceFill.quantity,
    }],
    queryOutcomes: [
      {
        kind: 'FOUND',
        status: 'FILLED',
        venueOrderId: sourceFill.venueOrderId,
        cumulativeFilledQuantity: sourceFill.quantity,
      },
      {
        kind: 'FOUND',
        status: 'FILLED',
        venueOrderId: flattenFill.venueOrderId,
        cumulativeFilledQuantity: flattenFill.quantity,
      },
    ],
    flattenOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: flattenFill.venueOrderId,
      cumulativeFilledQuantity: flattenFill.quantity,
    }],
    fillOutcomes: [[sourceFill], [flattenFill]],
    flatEvidence: (request) => exactFlatEvidenceFor(request, {
      revision: 'flat-evidence-third-asset-fee',
    }),
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(entryValue), flattenLeg('0.049')),
    ports,
  );

  assert.equal(result.status, 'FLAT_RECONCILED', JSON.stringify(result));
  assert.equal(result.lifecycle?.cumulativeFilledQuantity, '0.05');
  assert.equal(result.lifecycle?.cumulativeFlattenedQuantity, '0.049');
  assert.equal(calls.flatEvidence.length, 1);
  const request = calls.flatEvidence[0];
  assert.equal(request.sourceBaseCommissionQuantity, '0.001');
  assert.equal(request.flattenBaseCommissionQuantity, '0');
  assert.equal(request.expectedCanaryAttributableBaseDeltaQuantity, '0');
  assert.deepEqual(request.commissionTotals, [
    {
      leg: 'ENTRY',
      asset: 'TEST',
      quantity: '0.001',
    },
    {
      leg: 'FLATTEN',
      asset: 'BNB',
      quantity: '0.0005',
    },
  ]);
  assert.equal(
    request.quoteEconomicsStatus,
    'UNMEASURED_THIRD_ASSET_QUOTE_VALUE',
  );
  assert.equal(
    request.thirdAssetCommissionQuoteValueStatus,
    'UNMEASURED_NO_DIGEST_BOUND_VALUATION',
  );
  assert.equal(request.quoteCommissionDebit, '0');
  assert.deepEqual(request.fillDerivedQuoteCashflow, {
    direction: 'DEBIT',
    quantity: '0.1',
  });
});

test('same fill ID across source and flatten orders can never reconcile flat', async () => {
  const entryValue = ticket();
  const flatten = flattenLeg();
  const sourceFill = Object.freeze({
    fillId: 'fill-cross-order-collision',
    venueOrderId: 'venue-order-entry-collision',
    price: '100',
    quantity: '0.02',
    quoteQuantity: '2',
    commission: '0',
    commissionAsset: 'USDT',
    occurredAtMs: NOW - 100,
  });
  const flattenFill = Object.freeze({
    fillId: sourceFill.fillId,
    venueOrderId: 'venue-order-flatten-collision',
    price: '100',
    quantity: '0.02',
    quoteQuantity: '2',
    commission: '0',
    commissionAsset: 'USDT',
    occurredAtMs: NOW - 50,
  });
  const { calls, ports } = harness({
    admissions: [
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
      admitted(),
    ],
    submitOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: sourceFill.venueOrderId,
      cumulativeFilledQuantity: sourceFill.quantity,
    }],
    queryOutcomes: [
      {
        kind: 'FOUND',
        status: 'PARTIALLY_FILLED',
        venueOrderId: sourceFill.venueOrderId,
        cumulativeFilledQuantity: sourceFill.quantity,
      },
      {
        kind: 'FOUND',
        status: 'CANCELED',
        venueOrderId: sourceFill.venueOrderId,
        cumulativeFilledQuantity: sourceFill.quantity,
      },
      {
        kind: 'FOUND',
        status: 'FILLED',
        venueOrderId: flattenFill.venueOrderId,
        cumulativeFilledQuantity: flattenFill.quantity,
      },
    ],
    cancelOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: sourceFill.venueOrderId,
      cumulativeFilledQuantity: sourceFill.quantity,
    }],
    flattenOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: flattenFill.venueOrderId,
      cumulativeFilledQuantity: flattenFill.quantity,
    }],
    fillOutcomes: [[sourceFill], [flattenFill]],
    flatEvidence: (request) => exactFlatEvidenceFor(request, {
      revision: 'flat-evidence-fill-collision',
    }),
  });

  const result = await runSpotTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(entryValue), flatten),
    ports,
  );

  assert.equal(result.status, 'RECOVERY_REQUIRED');
  assert.notEqual(result.status, 'FLAT_RECONCILED');
  assert.ok(
    result.reasonCodes.includes('FLATTEN_DERIVATION_FAILED'),
    JSON.stringify(result),
  );
  assert.equal(result.lifecycle?.lifecycle, 'FLAT');
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.flatten.length, 1);
  assert.equal(calls.fills.length, 2);
  assert.equal(calls.flatEvidence.length, 0);
  assert.equal(calls.ledger.length, 3);
  assert.equal(calls.ledger.at(-1).status, 'SUBMITTING');
});

test('boot recovery proves an ambiguous source absent without entry or signed-test reuse', async () => {
  const entryValue = ticket();
  const { calls, ports } = harness({
    admissions: [admitted({
      sourceEnabled: false,
      killSwitchEngaged: true,
      allowedSymbols: Object.freeze([]),
      blockedSymbols: Object.freeze([SYMBOL]),
    })],
    queryOutcomes: [{
      kind: 'AUTHORITATIVE_NOT_FOUND',
      originalClientOrderId: entryValue.clientOrderId,
    }],
    flatEvidence: (request) => exactFlatEvidenceFor(request, {
      revision: 'flat-evidence-source-absent',
    }),
  });
  const result = await runSpotRecoveryTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(entryValue), null, {
      mode: 'RECOVERY_ONLY',
      sourceVenueOrderId: null,
    }),
    ports,
  );

  assert.equal(result.status, 'FLAT_RECONCILED', JSON.stringify(result));
  assert.equal(calls.signedTest.length, 0);
  assert.equal(calls.submit.length, 0);
  assert.equal(calls.flatten.length, 0);
  assert.equal(calls.query.length, 1);
  assert.equal(calls.flatEvidence[0].sourceOrderAuthoritativelyAbsent, true);
});

test('boot recovery resumes exact prior attempts at a fresh client identity', async () => {
  const entryValue = ticket();
  const sourceOrderId = 'venue-source-recovery-resume';
  const priorTicket = flattenLeg('0.05').ticket;
  const priorAttempt = Object.freeze({
    attempt: 1,
    ticket: priorTicket,
    venueOrderId: null,
    authoritativelyAbsent: true,
    terminal: true,
    fillsComplete: true,
    fills: Object.freeze([]),
  });
  const sourceFill = observedFill(
    'fill-source-recovery-resume',
    sourceOrderId,
    '0.05',
  );
  const nextFlattenVenueId = 'venue-flatten-recovery-2';
  const nextFlattenFill = observedFill(
    'fill-flatten-recovery-2',
    nextFlattenVenueId,
    '0.05',
  );
  const { calls, ports } = harness({
    admissions: [
      admitted({ sourceEnabled: false, killSwitchEngaged: true }),
      admitted({ sourceEnabled: false, killSwitchEngaged: true }),
      admitted({ sourceEnabled: false, killSwitchEngaged: true }),
      admitted({ sourceEnabled: false, killSwitchEngaged: true }),
    ],
    queryOutcomes: [{
      kind: 'FOUND',
      status: 'FILLED',
      venueOrderId: sourceOrderId,
      cumulativeFilledQuantity: '0.05',
    }, {
      kind: 'FOUND',
      status: 'FILLED',
      venueOrderId: nextFlattenVenueId,
      cumulativeFilledQuantity: '0.05',
    }],
    fillOutcomes: [[sourceFill], [nextFlattenFill]],
    flattenOutcomes: [{
      kind: 'ACKNOWLEDGED',
      venueOrderId: nextFlattenVenueId,
      cumulativeFilledQuantity: '0.05',
    }],
    flatEvidence: (request) => exactFlatEvidenceFor(request, {
      revision: 'flat-evidence-recovery-resume',
    }),
  });
  const result = await runSpotRecoveryTransportCoordinator(
    SYMBOL,
    coordinatorInput(leg(entryValue), null, {
      mode: 'RECOVERY_ONLY',
      sourceVenueOrderId: sourceOrderId,
      priorFlattenAttempts: [priorAttempt],
    }),
    ports,
  );

  assert.equal(result.status, 'FLAT_RECONCILED', JSON.stringify(result));
  assert.equal(calls.signedTest.length, 0);
  assert.equal(calls.submit.length, 0);
  assert.equal(calls.flatten.length, 1);
  assert.equal(calls.flatten[0].flattenTicket.attempt, 2);
  assert.notEqual(
    calls.flatten[0].flattenTicket.clientOrderId,
    priorTicket.clientOrderId,
  );
  assert.equal(calls.flatEvidence[0].flattenAttempts.length, 2);
});
