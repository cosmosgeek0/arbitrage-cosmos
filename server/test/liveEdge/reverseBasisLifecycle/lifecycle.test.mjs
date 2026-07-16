import assert from 'node:assert/strict';
import test from 'node:test';

import {
  baseInput,
  closedInput,
  confirmedBorrow,
  confirmedRepay,
  EVALUATED_AT_MS,
  event,
  liability,
  orderObservation,
  policySet,
  MARGIN_REALM,
  run,
  standardLifecycleEvents,
} from './fixtures.mjs';

test('full borrow, sell, actual-fill hedge, cover, close and repay reaches CLOSED', () => {
  const state = run(closedInput());
  assert.equal(state.stage, 'CLOSED');
  assert.equal(state.preflightPassed, true);
  assert.deepEqual(state.reasonCodes, []);
  assert.equal(state.exposure.borrowedPrincipal, '0');
  assert.equal(state.exposure.accruedInterest, '0');
  assert.equal(state.exposure.totalLiability, '0');
  assert.equal(state.exposure.marginShortRemaining, '0');
  assert.equal(state.exposure.futuresLongRemaining, '0');
  assert.equal(state.exposure.hedgeDriftQuantity, '0');
  assert.deepEqual(state.openOrderRefs, []);
  assert.deepEqual(state.ambiguousMutationRefs, []);
  assert.deepEqual(state.unmatchedFillRefs, []);
});

test('event trace exposes every staged transition instead of synthetic atomicity', () => {
  const state = run(closedInput());
  assert.deepEqual(state.processedEvents.map((item) => item.stageAfter), [
    'RECOVERY_REQUIRED',
    'LIABILITY_CONFIRMED',
    'HEDGE_WORKING',
    'OPEN',
    'EXITING',
    'EXITING',
    'REPAYING',
    'REPAYING',
    'CLOSED',
  ]);
});

test('the same event set is deterministic regardless of supplied array order', () => {
  const forward = closedInput();
  const reverse = structuredClone(forward);
  reverse.events.reverse();
  const left = run(forward);
  const right = run(reverse);
  assert.equal(left.inputRevision, right.inputRevision);
  assert.equal(left.stateRevision, right.stateRevision);
  assert.deepEqual(left, right);
});

test('confirmed liability is explicit before any Margin sale', () => {
  const policies = policySet();
  const state = run(baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
    ],
  }));
  assert.equal(state.stage, 'LIABILITY_CONFIRMED');
  assert.equal(state.borrow.transactionId, 'borrow-transaction-l10-001');
  assert.equal(state.exposure.totalLiability, '0.03');
});

test('actual Margin sale fill creates visible one-leg exposure until hedged', () => {
  const policies = policySet();
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const state = run(baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, margin.payload),
    ],
  }));
  assert.equal(state.stage, 'HEDGE_WORKING');
  assert.equal(state.exposure.marginShortRemaining, '0.03');
  assert.equal(state.exposure.futuresLongRemaining, '0');
  assert.equal(state.exposure.hedgeDriftQuantity, '0.03');
});

test('Futures hedge binds exactly to the actual Margin fill and opens the pair', () => {
  const policies = policySet();
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const futures = orderObservation(policies, 'FUTURES_ENTRY_HEDGE');
  const state = run(baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, margin.payload),
      event('ORDER_OBSERVED', 4, futures.payload),
    ],
  }));
  assert.equal(state.stage, 'OPEN');
  assert.equal(state.exposure.marginSaleFilled, '0.03');
  assert.equal(state.exposure.futuresEntryFilled, '0.03');
  assert.equal(state.exposure.hedgeDriftQuantity, '0');
});

test('partial Margin sale hedges only its accepted L07 fill', () => {
  const policies = policySet();
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL', {
    liquidityQuantity: '0.01',
    fixtureSuffix: 'partial',
  });
  assert.equal(margin.order.filledQuantity, '0.01');
  const futures = orderObservation(policies, 'FUTURES_ENTRY_HEDGE', {
    quantity: '0.01',
    fixtureSuffix: 'partial',
  });
  const state = run(baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, margin.payload),
      event('ORDER_OBSERVED', 4, futures.payload),
    ],
  }));
  assert.equal(state.exposure.marginSaleFilled, '0.01');
  assert.equal(state.exposure.futuresEntryFilled, '0.01');
  assert.equal(state.exposure.hedgeDriftQuantity, '0');
  assert.equal(state.stage, 'OPEN');
});

test('requested hedge larger than actual Margin fill is rejected at the lifecycle seam', () => {
  const policies = policySet();
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL', {
    liquidityQuantity: '0.01',
    fixtureSuffix: 'overhedge',
  });
  const futures = orderObservation(policies, 'FUTURES_ENTRY_HEDGE', {
    quantity: '0.03',
    fixtureSuffix: 'overhedge',
  });
  const value = baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, margin.payload),
      event('ORDER_OBSERVED', 4, futures.payload),
    ],
  });
  assert.throws(() => run(value), /hedge must request exactly the outstanding actual Margin fill/);
});

test('Margin sale request greater than confirmed borrowed principal is rejected before admission', () => {
  const policies = policySet();
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL', {
    quantity: '0.04',
    liquidityQuantity: '0.04',
    fixtureSuffix: 'oversale',
  });
  const value = baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, margin.payload),
    ],
  });
  assert.throws(
    () => run(value),
    /quantity ceiling|Margin sale request must exactly match confirmed borrowed principal/,
  );
});

test('interest-boundary liability keeps principal and accrued interest separate and exact', () => {
  const policies = policySet();
  const withInterest = liability({
    principal: '0.03',
    accruedInterest: '0.0001',
    totalLiability: '0.0301',
    revision: 'liability-revision-l10-interest-001',
  });
  const state = run(baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('LIABILITY_OBSERVED', 3, withInterest),
    ],
  }));
  assert.equal(state.exposure.borrowedPrincipal, '0.03');
  assert.equal(state.exposure.accruedInterest, '0.0001');
  assert.equal(state.exposure.totalLiability, '0.0301');
});

test('repay plus zero liability without closure reconciliation remains non-terminal', () => {
  const policies = policySet();
  const events = standardLifecycleEvents(policies).slice(0, -1);
  const state = run(baseInput({ policies, events }));
  assert.equal(state.stage, 'REPAYING');
  assert.notEqual(state.stage, 'CLOSED');
  assert.equal(state.exposure.totalLiability, '0');
});

test('repay amount may include accrued interest while zero truth remains separately verified', () => {
  const policies = policySet();
  const events = standardLifecycleEvents(policies).slice(0, 6);
  events.splice(2, 0, event('LIABILITY_OBSERVED', 21, liability({
    principal: '0.03',
    accruedInterest: '0.0001',
    totalLiability: '0.0301',
    revision: 'liability-revision-l10-interest-002',
  })));
  events.push(event('REPAY_OBSERVED', 30, confirmedRepay({
    requestedRepayAmount: '0.0301',
    confirmedRepayAmount: '0.0301',
    liabilityRevision: 'liability-revision-l10-zero-interest-002',
  })));
  events.push(event('LIABILITY_OBSERVED', 31, liability({
    principal: '0', accruedInterest: '0', totalLiability: '0',
    repayStatus: 'ZERO_CONFIRMED', revision: 'liability-revision-l10-zero-interest-002',
    observedAtMs: EVALUATED_AT_MS - 50,
  })));
  const state = run(baseInput({ policies, events }));
  assert.equal(state.stage, 'REPAYING');
  assert.equal(state.repay.confirmedRepayAmount, '0.0301');
  assert.equal(state.exposure.totalLiability, '0');
});

test('interest accrued after the four legs is included in repay and can close exactly', () => {
  const policies = policySet();
  const events = standardLifecycleEvents(policies).slice(0, 6);
  const accrued = liability({
    principal: '0.03', accruedInterest: '0.0001', totalLiability: '0.0301',
    revision: 'liability-revision-l10-post-leg-interest-001',
    observedAtMs: EVALUATED_AT_MS - 100,
  });
  const zero = liability({
    principal: '0', accruedInterest: '0', totalLiability: '0',
    repayStatus: 'ZERO_CONFIRMED', revision: 'liability-revision-l10-post-leg-zero-001',
    observedAtMs: EVALUATED_AT_MS - 50,
  });
  const repay = confirmedRepay({
    requestedRepayAmount: '0.0301', confirmedRepayAmount: '0.0301',
    liabilityRevision: zero.liabilityRevision,
  });
  events.push(event('LIABILITY_OBSERVED', 20, accrued));
  events.push(event('REPAY_OBSERVED', 21, repay));
  events.push(event('LIABILITY_OBSERVED', 22, zero));
  events.push(event('CLOSURE_RECONCILED', 23, {
    state: 'EXACT',
    accountRealmId: MARGIN_REALM,
    liabilityRevision: zero.liabilityRevision,
    borrowTransactionId: 'borrow-transaction-l10-001',
    repayTransactionId: repay.transactionId,
    orderStateRevisions: events.filter((item) => item.kind === 'ORDER_OBSERVED')
      .map((item) => item.payload.twinScenario.orders[0].venueRevision).sort(),
    openOrderRefs: [], ambiguousMutationRefs: [], unmatchedFillRefs: [],
    marginShortRemaining: '0', futuresLongRemaining: '0',
    observedAtMs: EVALUATED_AT_MS - 50,
    validUntilMs: EVALUATED_AT_MS + 10_000,
    reconciliationRevision: 'closure-reconciliation-l10-post-leg-interest-001',
  }));
  const state = run(baseInput({ policies, events }));
  assert.equal(state.stage, 'CLOSED');
  assert.equal(state.repayBasis.totalLiability, '0.0301');
  assert.equal(state.repay.confirmedRepayAmount, '0.0301');
});
