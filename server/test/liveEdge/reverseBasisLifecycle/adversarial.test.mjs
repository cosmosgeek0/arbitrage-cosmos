import assert from 'node:assert/strict';
import test from 'node:test';

import {
  baseInput,
  confirmedBorrow,
  confirmedRepay,
  EVALUATED_AT_MS,
  event,
  liability,
  orderObservation,
  policySet,
  run,
} from './fixtures.mjs';

test('Proxy input is rejected before domain evaluation', () => {
  const value = baseInput();
  value.preflight.borrowQuote = new Proxy(value.preflight.borrowQuote, {});
  assert.throws(() => run(value), /plain data only/);
});

test('accessor-bearing input is rejected without reading the accessor', () => {
  const value = baseInput();
  Object.defineProperty(value.ticket, 'poison', {
    enumerable: true,
    get() { throw new Error('accessor executed'); },
  });
  assert.throws(() => run(value), /accessors are forbidden/);
});

test('secret-shaped fields are rejected at every depth', () => {
  const value = baseInput();
  value.ticket.apiKey = 'not-a-real-value';
  assert.throws(() => run(value), /secret-shaped fields are forbidden/);
});

test('event content-address identity mismatch is rejected', () => {
  const value = baseInput();
  const observed = event('BORROW_OBSERVED', 1, confirmedBorrow());
  observed.eventId = 'l10evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  value.events = [observed];
  assert.throws(() => run(value), /event identity mismatch/);
});

test('duplicate event sequence is rejected deterministically', () => {
  const value = baseInput();
  value.events = [
    event('BORROW_OBSERVED', 1, confirmedBorrow()),
    event('LIABILITY_OBSERVED', 1, liability()),
  ];
  assert.throws(() => run(value), /event sequence is duplicated/);
});

test('event list is bounded before any reducer work', () => {
  const value = baseInput();
  const observed = event('BORROW_OBSERVED', 1, confirmedBorrow());
  value.events = Array.from({ length: 513 }, () => structuredClone(observed));
  assert.throws(() => run(value), /event list is invalid or overbound/);
});

test('liability principal plus interest must exactly equal total', () => {
  const value = baseInput();
  value.events = [
    event('BORROW_OBSERVED', 1, confirmedBorrow()),
    event('LIABILITY_OBSERVED', 2, liability({
      principal: '0.03', accruedInterest: '0.0001', totalLiability: '0.03',
    })),
  ];
  assert.throws(() => run(value), /principal plus accrued interest/);
});

test('confirmed borrow cannot omit transaction, principal or liability identity', () => {
  for (const field of ['transactionId', 'confirmedPrincipal', 'liabilityRevision']) {
    const observation = confirmedBorrow();
    observation[field] = null;
    const value = baseInput({ events: [event('BORROW_OBSERVED', 1, observation)] });
    assert.throws(() => run(value), /confirmed borrow lacks/, field);
  }
});

test('confirmed repay cannot omit transaction, amount or liability identity', () => {
  for (const field of ['transactionId', 'confirmedRepayAmount', 'liabilityRevision']) {
    const observation = confirmedRepay();
    observation[field] = null;
    const value = baseInput({ events: [event('REPAY_OBSERVED', 1, observation)] });
    assert.throws(() => run(value), /confirmed repay lacks/, field);
  }
});

test('borrow/liability identity cannot cross account realm or isolated symbol', () => {
  const wrongRealm = confirmedBorrow({ accountRealmId: 'margin-realm-foreign-l10' });
  assert.throws(
    () => run(baseInput({ events: [event('BORROW_OBSERVED', 1, wrongRealm)] })),
    /verified Margin identity/,
  );
  const wrongSymbol = liability({ isolatedSymbol: 'ETHUSDT' });
  assert.throws(
    () => run(baseInput({ events: [event('LIABILITY_OBSERVED', 1, wrongSymbol)] })),
    /verified Margin identity/,
  );
});

test('L07 Spot mutation identity cannot be relabeled as the Margin hand', () => {
  const twinRealm = 'account-realm:spot-mechanics-l10-synthetic';
  const policies = policySet({ marginRealm: twinRealm });
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const value = baseInput({ policies });
  value.ticket.account.accountRealmId = twinRealm;
  value.preflight.collateral.accountRealmId = twinRealm;
  value.preflight.borrowQuote.accountRealmId = twinRealm;
  value.events = [event('ORDER_OBSERVED', 1, margin.payload)];
  assert.throws(() => run(value), /cannot be relabeled as the Margin hand/);
});

test('no-effect rejection cannot coexist with an L07 fill', () => {
  const policies = policySet();
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  margin.payload.mutationState = 'REJECTED_NO_EFFECT_PROVEN';
  margin.payload.accountOrderId = null;
  const value = baseInput({
    policies,
    events: [event('ORDER_OBSERVED', 1, margin.payload)],
  });
  assert.throws(() => run(value), /no-effect rejection conflicts with L07 venue effects/);
});

test('future-dated event is rejected', () => {
  const value = baseInput();
  value.events = [event(
    'BORROW_OBSERVED',
    1,
    confirmedBorrow(),
    EVALUATED_AT_MS + 1,
  )];
  assert.throws(() => run(value), /event occurs after lifecycle evaluation/);
});

test('noncanonical decimal and exponent syntax are rejected', () => {
  for (const requestedPrincipal of ['0.030', '3e-2', '-0.03']) {
    const value = baseInput();
    value.ticket.requestedPrincipal = requestedPrincipal;
    assert.throws(() => run(value), /canonical non-negative exact decimal|must be canonical/, requestedPrincipal);
  }
});

test('liability observation time cannot regress', () => {
  const latest = liability({
    observedAtMs: EVALUATED_AT_MS - 430,
    revision: 'liability-revision-l10-current-001',
  });
  const older = liability({
    observedAtMs: EVALUATED_AT_MS - 435,
    revision: 'liability-older-l10-001',
  });
  const value = baseInput({
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, latest),
      event('LIABILITY_OBSERVED', 3, older),
    ],
  });
  assert.throws(() => run(value), /liability observation time regressed/);
});

test('same order reference cannot regress filled quantity', () => {
  const policies = policySet();
  const full = orderObservation(policies, 'MARGIN_ENTRY_SELL', {
    fixtureSuffix: 'fill-regression',
  });
  const partial = orderObservation(policies, 'MARGIN_ENTRY_SELL', {
    fixtureSuffix: 'fill-regression',
    liquidityQuantity: '0.01',
  });
  partial.payload.orderRef = full.payload.orderRef;
  partial.payload.accountOrderId = full.payload.accountOrderId;
  const value = baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, full.payload),
      event('ORDER_OBSERVED', 4, partial.payload),
    ],
  });
  assert.throws(() => run(value), /conflicts with prior order truth/);
});

test('zero liability must be explicitly ZERO_CONFIRMED', () => {
  const invalid = liability({
    principal: '0', accruedInterest: '0', totalLiability: '0', repayStatus: 'NOT_REPAID',
  });
  assert.throws(
    () => run(baseInput({ events: [event('LIABILITY_OBSERVED', 1, invalid)] })),
    /zero liability must be explicitly ZERO_CONFIRMED/,
  );
});
