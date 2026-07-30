import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M0_SPOT_ACTION_ALLOWLIST,
  M0_SPOT_ACTION_AUTHORITY_SCHEMA,
  M0_SPOT_ACTION_CONSUMPTION_SCHEMA,
  M0_SPOT_LIFECYCLE_CARD_SCHEMA,
  M0_SPOT_MAXIMUM_FLATTEN_CANCEL_SUBMISSIONS,
  M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS,
  calculateM0SpotIntentDigest,
  calculateM0SpotLifecycleCardDigest,
  deriveM0SpotActionAuthorizationId,
  deriveM0SpotLifecycleCardId,
  deriveM0SpotLifecycleId,
  evaluateM0SpotActionCardinality,
  validateM0SpotActionAuthority,
  validateM0SpotActionConsumptionReceipt,
  validateM0SpotLifecycleCard,
} from '../../../dist/foundation/execution/m0SpotLifecycleCard.js';
import {
  createSpotExecutionTicket,
} from '../../../dist/foundation/execution/spotTicket.js';

const NOW = 1_900_000_000_000;
const MONOTONIC_NOW = 50_000;
const CARD_FENCE = 'm0_clock_fence_card_test_fence_0001';
const RECOVERY_FENCE = 'm0_clock_fence_recovery_test_0001';

function makeTicket(overrides = {}) {
  return createSpotExecutionTicket({
    correlationId: 'cor_m0_card_001',
    planId: 'plan_m0_card_001',
    accountId: 'binance-account-4',
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'FOK',
    quantity: '0.001',
    price: '10000',
    riskReferencePrice: '10000',
    estimatedMaxLossQuote: '2',
    purpose: 'ENTRY',
    attempt: 0,
    createdAtMs: NOW - 2_000,
    expiresAtMs: NOW + 120_000,
    ...overrides,
  });
}

function makeCard(ticket = makeTicket(), overrides = {}) {
  const withoutDigest = {
    schema: M0_SPOT_LIFECYCLE_CARD_SCHEMA,
    version: 1,
    cardId: deriveM0SpotLifecycleCardId({
      ownerId: 'owner-account-4',
      accountId: ticket.accountId,
      entryTicketId: ticket.ticketId,
      signedTestEvidenceRevision: 'signed-test-evidence-v1',
      controlRevision: 'control-revision-v1',
    }),
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
    maximumGrossLifecycleTurnoverQuote:
      String(Number(ticket.orderNotionalQuote) * 2),
    maximumResidualDustNotionalQuote: '0.1',
    maximumLossQuote: ticket.estimatedMaxLossQuote,
    maximumExposureDurationMs: 60_000,
    maximumSignedTestSubmissions: 1,
    maximumEntrySubmissions: 1,
    maximumEntryCancelSubmissions: 1,
    maximumFlattenSubmissions: M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS,
    maximumFlattenCancelSubmissions:
      M0_SPOT_MAXIMUM_FLATTEN_CANCEL_SUBMISSIONS,
    recoveryAuthorizedUntil: 'EXACT_FLAT_RECONCILED',
    filterSnapshotRevision: 'filters-v1',
    feeEvidenceRevision: 'fees-v1',
    privateReadRevision: 'private-read-v1',
    signedTestEvidenceRevision: 'signed-test-evidence-v1',
    controlRevision: 'control-revision-v1',
    clockFenceId: CARD_FENCE,
    issuedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 59_000,
    issuedMonotonicMs: MONOTONIC_NOW - 1_000,
    expiresMonotonicMs: MONOTONIC_NOW + 59_000,
    oneLifecycle: true,
    actionAllowlist: M0_SPOT_ACTION_ALLOWLIST,
    withdrawalsEnabled: false,
    transfersEnabled: false,
    futuresEnabled: false,
    marginBorrowEnabled: false,
    ...overrides,
  };
  return {
    ...withoutDigest,
    cardDigest: calculateM0SpotLifecycleCardDigest(withoutDigest),
  };
}

function makeAuthority({
  card,
  ticket,
  intent,
  action = 'ENTRY',
  context,
  issuedAtMs = NOW - 100,
  expiresAtMs = NOW + 5_000,
  issuedMonotonicMs = MONOTONIC_NOW - 100,
  expiresMonotonicMs = MONOTONIC_NOW + 5_000,
  overrides = {},
}) {
  const intentDigest = calculateM0SpotIntentDigest(intent);
  const withoutOverrides = {
    schema: M0_SPOT_ACTION_AUTHORITY_SCHEMA,
    version: 1,
    authorizationId: deriveM0SpotActionAuthorizationId({
      lifecycleId: context.lifecycleId,
      action,
      ticketId: ticket.ticketId,
      intentDigest,
      stateRevision: context.stateRevision,
    }),
    verification: 'VERIFIED_BY_CANONICAL_LIFECYCLE_OWNER',
    lifecycleId: context.lifecycleId,
    cardId: card.cardId,
    cardDigest: card.cardDigest,
    action,
    ticketId: ticket.ticketId,
    termsDigest: ticket.termsDigest,
    clientOrderId: ticket.clientOrderId,
    intentDigest,
    stateRevision: context.stateRevision,
    clockFenceId: context.currentClockFenceId,
    issuedAtMs,
    expiresAtMs,
    issuedMonotonicMs,
    expiresMonotonicMs,
    singleUse: true,
  };
  return { ...withoutOverrides, ...overrides };
}

function makeReceipt(authority, overrides = {}) {
  return {
    schema: M0_SPOT_ACTION_CONSUMPTION_SCHEMA,
    version: 1,
    lifecycleId: authority.lifecycleId,
    authorizationId: authority.authorizationId,
    cardId: authority.cardId,
    cardDigest: authority.cardDigest,
    action: authority.action,
    ticketId: authority.ticketId,
    termsDigest: authority.termsDigest,
    clientOrderId: authority.clientOrderId,
    intentDigest: authority.intentDigest,
    stateRevision: authority.stateRevision,
    nextStateRevision: authority.stateRevision + 1,
    clockFenceId: authority.clockFenceId,
    consumedAtMs: NOW,
    consumedMonotonicMs: MONOTONIC_NOW,
    state: 'CONSUMED_ONCE',
    authorizationReuseAllowed: false,
    ...overrides,
  };
}

test('card and lifecycle identities and digests are deterministic and exact', () => {
  const ticket = makeTicket();
  const first = makeCard(ticket);
  const second = makeCard(makeTicket());

  assert.deepEqual(first, second);
  assert.match(first.cardDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    deriveM0SpotLifecycleId(first.cardDigest),
    deriveM0SpotLifecycleId(second.cardDigest),
  );
  assert.notEqual(
    makeCard(ticket, { controlRevision: 'control-revision-v2' }).cardDigest,
    first.cardDigest,
  );
  assert.deepEqual(
    validateM0SpotLifecycleCard(
      first,
      ticket,
      NOW,
      CARD_FENCE,
      MONOTONIC_NOW,
    ),
    { ok: true, card: first },
  );
});

test('card validation is closed and enforces ticket, $10 and time fences', () => {
  const ticket = makeTicket();
  const valid = makeCard(ticket);
  const validate = (card, candidateTicket = ticket) =>
    validateM0SpotLifecycleCard(
      card,
      candidateTicket,
      NOW,
      CARD_FENCE,
      MONOTONIC_NOW,
    );

  assert.deepEqual(validate({ ...valid, unexpected: true }), {
    ok: false,
    code: 'CARD_INVALID',
  });
  assert.deepEqual(validate(makeCard(ticket, {
    maximumEntrySubmissions: 2,
  })), {
    ok: false,
    code: 'CARD_INVALID',
  });
  const gtcEntry = makeTicket({ timeInForce: 'GTC' });
  assert.deepEqual(validate(makeCard(gtcEntry), gtcEntry), {
    ok: false,
    code: 'CARD_TICKET_MISMATCH',
  });
  assert.deepEqual(validate(makeCard(ticket, {
    actionAllowlist: [...M0_SPOT_ACTION_ALLOWLIST, 'SUBMIT_ANY_ORDER'],
  })), {
    ok: false,
    code: 'CARD_INVALID',
  });

  const overCeilingTicket = makeTicket({ quantity: '0.0011' });
  assert.deepEqual(validate(
    makeCard(overCeilingTicket, {
      maximumSimultaneousExposureQuote: '11',
      maximumGrossLifecycleTurnoverQuote: '22',
    }),
    overCeilingTicket,
  ), {
    ok: false,
    code: 'CARD_NOTIONAL_INVALID',
  });

  assert.deepEqual(validate(makeCard(ticket, {
    expiresAtMs: NOW,
    expiresMonotonicMs: MONOTONIC_NOW,
  })), {
    ok: false,
    code: 'CARD_TIME_INVALID',
  });
  assert.deepEqual(validate(makeCard(ticket, {
    expiresMonotonicMs: MONOTONIC_NOW + 58_999,
  })), {
    ok: false,
    code: 'CARD_TIME_INVALID',
  });
  assert.deepEqual(validate(
    { ...valid, cardDigest: `sha256:${'0'.repeat(64)}` },
  ), {
    ok: false,
    code: 'CARD_DIGEST_MISMATCH',
  });
});

test('pure action cardinality keeps entry one and recovery bounded', () => {
  const ticket = makeTicket();
  const card = makeCard(ticket);
  const base = {
    disarmedSafe: false,
    armed: false,
    newEntryArmed: false,
    entryPresent: true,
    entryTerminal: true,
    residualQuantity: '0.001',
    activeFlattenPresent: false,
    recoveryActive: true,
    consumedActionCount: 0,
  };
  assert.equal(evaluateM0SpotActionCardinality(
    card,
    'FLATTEN',
    base,
  ).allowed, true);
  assert.deepEqual(evaluateM0SpotActionCardinality(
    card,
    'FLATTEN',
    {
      ...base,
      consumedActionCount: M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS,
    },
  ), {
    allowed: false,
    limit: M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS,
    consumed: M0_SPOT_MAXIMUM_FLATTEN_SUBMISSIONS,
    code: 'ACTION_LIMIT_EXHAUSTED',
  });
  assert.equal(evaluateM0SpotActionCardinality(
    card,
    'ENTRY',
    {
      ...base,
      armed: true,
      newEntryArmed: true,
      recoveryActive: false,
      entryPresent: false,
    },
  ).allowed, true);
  assert.equal(evaluateM0SpotActionCardinality(
    card,
    'ENTRY',
    {
      ...base,
      armed: true,
      newEntryArmed: true,
      recoveryActive: false,
      entryPresent: false,
      consumedActionCount: 1,
    },
  ).allowed, false);
});

test('FLATTEN_CANCEL binds the active ticket even after residual changes', () => {
  const entry = makeTicket();
  const card = makeCard(entry);
  const flatten = makeTicket({
    side: 'SELL',
    purpose: 'FLATTEN',
    quantity: '0.001',
    attempt: 1,
  });
  const intent = Object.freeze({
    kind: 'FLATTEN_CANCEL',
    originalClientOrderId: flatten.clientOrderId,
  });
  const context = Object.freeze({
    lifecycleId: deriveM0SpotLifecycleId(card.cardDigest),
    stateRevision: 13,
    currentClockFenceId: RECOVERY_FENCE,
    recoveryActive: true,
    residualQuantity: '0.0004',
    entryTicket: entry,
    activeFlattenTicket: flatten,
  });
  const authority = makeAuthority({
    card,
    ticket: flatten,
    intent,
    action: 'FLATTEN_CANCEL',
    context,
  });
  assert.equal(validateM0SpotActionAuthority(
    authority,
    card,
    'FLATTEN_CANCEL',
    flatten,
    intent,
    context,
    NOW,
    MONOTONIC_NOW,
  ).ok, true);
  assert.equal(validateM0SpotActionAuthority(
    authority,
    card,
    'FLATTEN_CANCEL',
    flatten,
    intent,
    { ...context, activeFlattenTicket: null },
    NOW,
    MONOTONIC_NOW,
  ).ok, false);
});

test('entry authority is one-action, one-intent, one-state and one-use bound', () => {
  const ticket = makeTicket();
  const card = makeCard(ticket);
  const intent = Object.freeze({ kind: 'ENTRY', ticketId: ticket.ticketId });
  const context = Object.freeze({
    lifecycleId: deriveM0SpotLifecycleId(card.cardDigest),
    stateRevision: 7,
    currentClockFenceId: CARD_FENCE,
    recoveryActive: false,
    residualQuantity: null,
    entryTicket: ticket,
  });
  const authority = makeAuthority({ card, ticket, intent, context });

  assert.deepEqual(
    validateM0SpotActionAuthority(
      authority,
      card,
      'ENTRY',
      ticket,
      intent,
      context,
      NOW,
      MONOTONIC_NOW,
    ),
    { ok: true, authority },
  );
  assert.deepEqual(
    validateM0SpotActionAuthority(
      authority,
      card,
      'ENTRY',
      ticket,
      { ...intent, changed: true },
      context,
      NOW,
      MONOTONIC_NOW,
    ),
    { ok: false, code: 'AUTHORITY_BINDING_MISMATCH' },
  );
  assert.deepEqual(
    validateM0SpotActionAuthority(
      { ...authority, unexpected: true },
      card,
      'ENTRY',
      ticket,
      intent,
      context,
      NOW,
      MONOTONIC_NOW,
    ),
    { ok: false, code: 'AUTHORITY_BINDING_MISMATCH' },
  );
  assert.deepEqual(
    validateM0SpotActionAuthority(
      { ...authority, singleUse: false },
      card,
      'ENTRY',
      ticket,
      intent,
      context,
      NOW,
      MONOTONIC_NOW,
    ),
    { ok: false, code: 'AUTHORITY_BINDING_MISMATCH' },
  );
});

test('recovery authority survives card expiry only while recovery is active', () => {
  const ticket = makeTicket();
  const card = makeCard(ticket);
  const intent = Object.freeze({
    kind: 'QUERY_ORDER',
    origClientOrderId: ticket.clientOrderId,
  });
  const evaluatedAtMs = NOW + 90_000;
  const evaluatedMonotonicMs = MONOTONIC_NOW + 90_000;
  const context = Object.freeze({
    lifecycleId: deriveM0SpotLifecycleId(card.cardDigest),
    stateRevision: 11,
    currentClockFenceId: RECOVERY_FENCE,
    recoveryActive: true,
    residualQuantity: '0.001',
    entryTicket: ticket,
  });
  const authority = makeAuthority({
    card,
    ticket,
    intent,
    action: 'QUERY_ORDER',
    context,
    issuedAtMs: evaluatedAtMs - 1_000,
    expiresAtMs: evaluatedAtMs + 5_000,
    issuedMonotonicMs: evaluatedMonotonicMs - 1_000,
    expiresMonotonicMs: evaluatedMonotonicMs + 5_000,
  });

  assert.equal(validateM0SpotActionAuthority(
    authority,
    card,
    'QUERY_ORDER',
    ticket,
    intent,
    context,
    evaluatedAtMs,
    evaluatedMonotonicMs,
  ).ok, true);
  assert.deepEqual(validateM0SpotActionAuthority(
    authority,
    card,
    'QUERY_ORDER',
    ticket,
    intent,
    { ...context, recoveryActive: false },
    evaluatedAtMs,
    evaluatedMonotonicMs,
  ), {
    ok: false,
    code: 'AUTHORITY_BINDING_MISMATCH',
  });

  const entryIntent = Object.freeze({ kind: 'ENTRY', ticketId: ticket.ticketId });
  const entryAuthority = makeAuthority({
    card,
    ticket,
    intent: entryIntent,
    action: 'ENTRY',
    context,
    issuedAtMs: evaluatedAtMs - 1_000,
    expiresAtMs: evaluatedAtMs + 5_000,
    issuedMonotonicMs: evaluatedMonotonicMs - 1_000,
    expiresMonotonicMs: evaluatedMonotonicMs + 5_000,
  });
  assert.deepEqual(validateM0SpotActionAuthority(
    entryAuthority,
    card,
    'ENTRY',
    ticket,
    entryIntent,
    context,
    evaluatedAtMs,
    evaluatedMonotonicMs,
  ), {
    ok: false,
    code: 'AUTHORITY_BINDING_MISMATCH',
  });
});

test('consumption receipt closes over every authority and intent field', () => {
  const ticket = makeTicket();
  const card = makeCard(ticket);
  const intent = Object.freeze({ kind: 'ENTRY', ticketId: ticket.ticketId });
  const context = Object.freeze({
    lifecycleId: deriveM0SpotLifecycleId(card.cardDigest),
    stateRevision: 2,
    currentClockFenceId: CARD_FENCE,
    recoveryActive: false,
    residualQuantity: null,
    entryTicket: ticket,
  });
  const authority = makeAuthority({ card, ticket, intent, context });
  const receipt = makeReceipt(authority);

  assert.equal(validateM0SpotActionConsumptionReceipt(
    receipt,
    authority,
    intent,
    CARD_FENCE,
    NOW,
    MONOTONIC_NOW,
  ), true);
  for (const forged of [
    { ...receipt, authorizationReuseAllowed: true },
    { ...receipt, nextStateRevision: authority.stateRevision + 2 },
    { ...receipt, intentDigest: calculateM0SpotIntentDigest({ forged: true }) },
    { ...receipt, unexpected: true },
  ]) {
    assert.equal(validateM0SpotActionConsumptionReceipt(
      forged,
      authority,
      intent,
      CARD_FENCE,
      NOW,
      MONOTONIC_NOW,
    ), false);
  }
});
