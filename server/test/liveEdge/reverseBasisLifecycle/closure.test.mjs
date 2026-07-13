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
  MARGIN_REALM,
  orderObservation,
  policySet,
  run,
  standardLifecycleEvents,
} from './fixtures.mjs';

function replaceEvent(events, index, payload) {
  const old = events[index];
  events[index] = event(old.kind, old.sequence, payload, old.occurredAtMs);
}

function orderRevisions(events) {
  return events
    .filter((item) => item.kind === 'ORDER_OBSERVED')
    .map((item) => {
      const order = item.payload.twinScenario.orders
        .find((candidate) => candidate.fixture.fixtureId === item.payload.twinFixtureId);
      return order.venueRevision;
    })
    .sort();
}

test('residual accrued-interest dust prevents CLOSED', () => {
  const value = structuredClone(closedInput());
  const residual = liability({
    principal: '0',
    accruedInterest: '0.0001',
    totalLiability: '0.0001',
    repayStatus: 'PARTIALLY_REPAID',
    revision: 'liability-revision-l10-residual-interest-001',
    observedAtMs: EVALUATED_AT_MS - 140,
  });
  replaceEvent(value.events, 7, residual);
  const repay = structuredClone(value.events[6].payload);
  repay.liabilityRevision = residual.liabilityRevision;
  replaceEvent(value.events, 6, repay);
  const closure = structuredClone(value.events[8].payload);
  closure.liabilityRevision = residual.liabilityRevision;
  replaceEvent(value.events, 8, closure);
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.equal(state.exposure.totalLiability, '0.0001');
  assert.ok(state.reasonCodes.includes('CLOSURE_RESIDUAL_LIABILITY'));
  assert.notEqual(state.stage, 'CLOSED');
});

test('residual principal prevents CLOSED even when repay mutation was confirmed', () => {
  const value = structuredClone(closedInput());
  const residual = liability({
    principal: '0.001',
    accruedInterest: '0',
    totalLiability: '0.001',
    repayStatus: 'PARTIALLY_REPAID',
    revision: 'liability-revision-l10-residual-principal-001',
    observedAtMs: EVALUATED_AT_MS - 140,
  });
  replaceEvent(value.events, 7, residual);
  const repay = structuredClone(value.events[6].payload);
  repay.liabilityRevision = residual.liabilityRevision;
  replaceEvent(value.events, 6, repay);
  const closure = structuredClone(value.events[8].payload);
  closure.liabilityRevision = residual.liabilityRevision;
  replaceEvent(value.events, 8, closure);
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.ok(state.reasonCodes.includes('CLOSURE_RESIDUAL_LIABILITY'));
});

test('closure evidence reporting an open order keeps the ticket in recovery', () => {
  const value = structuredClone(closedInput());
  const closure = structuredClone(value.events[8].payload);
  closure.openOrderRefs = ['external-margin-order-open-001'];
  replaceEvent(value.events, 8, closure);
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.deepEqual(state.openOrderRefs, ['external-margin-order-open-001']);
  assert.ok(state.reasonCodes.includes('CLOSURE_OPEN_ORDERS_REMAIN'));
});

test('a confirmed order without local observation/reconciliation is ambiguous and cannot close', () => {
  const policies = policySet();
  const value = closedInput({ policies });
  const ambiguousExit = orderObservation(policies, 'FUTURES_EXIT_CLOSE', {
    includePrivate: false,
    fixtureSuffix: 'unobserved',
  });
  replaceEvent(value.events, 5, ambiguousExit.payload);
  value.events = value.events.slice(0, 6);
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.ok(state.ambiguousMutationRefs.includes('order-ref-futures-exit-close'));
  assert.ok(state.reasonCodes.includes('AMBIGUOUS_MUTATION_PRESENT'));
});

test('an UNKNOWN mutation remains ambiguous even if the synthetic venue filled', () => {
  const policies = policySet();
  const value = closedInput({ policies });
  const unknown = orderObservation(policies, 'FUTURES_EXIT_CLOSE', {
    mutationState: 'UNKNOWN',
    fixtureSuffix: 'unknown',
  });
  assert.equal(unknown.order.filledQuantity, '0.03');
  replaceEvent(value.events, 5, unknown.payload);
  value.events = value.events.slice(0, 6);
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.ok(state.ambiguousMutationRefs.includes('order-ref-futures-exit-close'));
  assert.ok(state.reasonCodes.includes('AMBIGUOUS_MUTATION_PRESENT'));
});

test('unmatched fill evidence from canonical reconciliation prevents closure', () => {
  const value = structuredClone(closedInput());
  const closure = structuredClone(value.events[8].payload);
  closure.unmatchedFillRefs = ['unmatched-margin-fill-001'];
  replaceEvent(value.events, 8, closure);
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.deepEqual(state.unmatchedFillRefs, ['unmatched-margin-fill-001']);
  assert.ok(state.reasonCodes.includes('CLOSURE_UNMATCHED_FILLS_REMAIN'));
});

test('partial cover plus matching Futures reduction still preserves residual short exposure', () => {
  const policies = policySet();
  const marginEntry = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const futuresEntry = orderObservation(policies, 'FUTURES_ENTRY_HEDGE');
  const marginExit = orderObservation(policies, 'MARGIN_EXIT_COVER', {
    liquidityQuantity: '0.01',
    fixtureSuffix: 'partial-cover',
  });
  const futuresExit = orderObservation(policies, 'FUTURES_EXIT_CLOSE', {
    quantity: '0.01',
    fixtureSuffix: 'partial-cover',
  });
  const events = [
    event('BORROW_OBSERVED', 1, confirmedBorrow()),
    event('LIABILITY_OBSERVED', 2, liability()),
    event('ORDER_OBSERVED', 3, marginEntry.payload),
    event('ORDER_OBSERVED', 4, futuresEntry.payload),
    event('ORDER_OBSERVED', 5, marginExit.payload),
    event('ORDER_OBSERVED', 6, futuresExit.payload),
  ];
  const state = run(baseInput({ policies, events }));
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.equal(state.exposure.marginShortRemaining, '0.02');
  assert.equal(state.exposure.futuresLongRemaining, '0.02');
  assert.equal(state.exposure.totalLiability, '0.03');
  assert.ok(state.reasonCodes.some((reason) => reason.startsWith('EXIT_PARTIAL_REMAINDER:')));
});

test('stale closure evidence cannot produce a terminal state', () => {
  const value = structuredClone(closedInput());
  const closure = structuredClone(value.events[8].payload);
  closure.validUntilMs = EVALUATED_AT_MS - 1;
  replaceEvent(value.events, 8, closure);
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.ok(state.reasonCodes.includes('CLOSURE_RECONCILIATION_STALE'));
});

test('PARTIAL, AMBIGUOUS and UNAVAILABLE closure truth all fail closed', () => {
  for (const closureState of ['PARTIAL', 'AMBIGUOUS', 'UNAVAILABLE']) {
    const value = structuredClone(closedInput());
    const closure = structuredClone(value.events[8].payload);
    closure.state = closureState;
    replaceEvent(value.events, 8, closure);
    const state = run(value);
    assert.equal(state.stage, 'RECOVERY_REQUIRED', closureState);
    assert.ok(state.reasonCodes.includes(`CLOSURE_RECONCILIATION_${closureState}`));
  }
});

test('closure must bind the exact liability, borrow, repay and order revision set', () => {
  const cases = [
    ['liabilityRevision', 'liability-revision-wrong', 'CLOSURE_LIABILITY_REVISION_MISMATCH'],
    ['borrowTransactionId', 'borrow-transaction-wrong', 'CLOSURE_BORROW_TRANSACTION_MISMATCH'],
    ['repayTransactionId', 'repay-transaction-wrong', 'CLOSURE_REPAY_TRANSACTION_MISMATCH'],
  ];
  for (const [field, value, reason] of cases) {
    const input = structuredClone(closedInput());
    const closure = structuredClone(input.events[8].payload);
    closure[field] = value;
    replaceEvent(input.events, 8, closure);
    assert.ok(run(input).reasonCodes.includes(reason), field);
  }
  const input = structuredClone(closedInput());
  const closure = structuredClone(input.events[8].payload);
  closure.orderStateRevisions = closure.orderStateRevisions.slice(1);
  replaceEvent(input.events, 8, closure);
  assert.ok(run(input).reasonCodes.includes('CLOSURE_ORDER_REVISION_SET_MISMATCH'));
});

test('zero liability alone is insufficient without exact closure evidence', () => {
  const policies = policySet();
  const state = run(baseInput({
    policies,
    events: standardLifecycleEvents(policies).slice(0, -1),
  }));
  assert.equal(state.exposure.totalLiability, '0');
  assert.equal(state.stage, 'REPAYING');
  assert.notEqual(state.stage, 'CLOSED');
});
