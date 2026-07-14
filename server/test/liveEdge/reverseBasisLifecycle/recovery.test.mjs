import assert from 'node:assert/strict';
import test from 'node:test';

import {
  baseInput,
  confirmedBorrow,
  confirmedRepay,
  EVALUATED_AT_MS,
  RECOVERY_EVIDENCE_REVISION,
  event,
  liability,
  MARGIN_REALM,
  orderObservation,
  policySet,
  run,
} from './fixtures.mjs';

function recoveryEvidence(policies, overrides = {}) {
  const plan = policies.recovery.decision.selectedPlan;
  const { role = 'RECOVERY_MARGIN_COVER', ...evidenceOverrides } = overrides;
  const places = plan.actions.filter((item) => item.kind === 'PLACE').sort((a, b) => a.step - b.step);
  const legId = places[role === 'RECOVERY_MARGIN_COVER' ? 0 : 1].legId;
  const action = plan.actions.find((item) => item.kind === 'RECOVER' && item.legId === legId);
  return {
    recoveryRef: 'recovery-ref-l10-001',
    policyPlanRevision: plan.planRevision,
    policyActionId: action.actionId,
    riskMeasureBefore: '0.03',
    riskMeasureAfter: '0.01',
    grossNotionalAfter: '8',
    recoveryCostQuote: '1',
    liquidityState: 'AVAILABLE',
    collateralRevision: 'collateral-revision-l10-001',
    evidenceRevision: RECOVERY_EVIDENCE_REVISION,
    targetExposureRevision: action.targetExposureRevision,
    ...evidenceOverrides,
  };
}

test('borrow confirmed followed by rejected Margin sale preserves liability and requires recovery', () => {
  const policies = policySet();
  const rejected = orderObservation(policies, 'MARGIN_ENTRY_SELL', {
    mutationState: 'REJECTED_NO_EFFECT_PROVEN',
    fixtureSuffix: 'rejected-sale',
  });
  const state = run(baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, rejected.payload),
    ],
  }));
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.equal(state.exposure.totalLiability, '0.03');
  assert.equal(state.exposure.marginSaleFilled, '0');
  assert.ok(state.reasonCodes.some((reason) => reason.startsWith('ORDER_REJECTED:')));
});

test('borrow ambiguity is never treated as no effect or retried state', () => {
  const value = baseInput();
  value.events = [event('BORROW_OBSERVED', 1, confirmedBorrow({
    state: 'UNKNOWN',
    confirmedPrincipal: null,
    transactionId: null,
    liabilityRevision: null,
  }))];
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.ok(state.ambiguousMutationRefs.includes('borrow:borrow-evidence-l10-001'));
  assert.ok(state.reasonCodes.includes('BORROW_MUTATION_UNKNOWN'));
});

test('repay rejection leaves exact liability visible and recovery required', () => {
  const policies = policySet();
  const repayRejected = confirmedRepay({
    state: 'REJECTED_NO_EFFECT_PROVEN',
    confirmedRepayAmount: null,
    transactionId: null,
    liabilityRevision: null,
    evidenceRevision: 'repay-evidence-l10-rejected-001',
  });
  const state = run(baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('REPAY_OBSERVED', 3, repayRejected),
    ],
  }));
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.equal(state.exposure.totalLiability, '0.03');
  assert.ok(state.reasonCodes.includes('REPAY_REJECTED_NO_EFFECT_PROVEN'));
});

test('repay ambiguity is durable UNKNOWN and prevents terminal truth', () => {
  const policies = policySet();
  const repayUnknown = confirmedRepay({
    state: 'UNKNOWN',
    confirmedRepayAmount: null,
    transactionId: null,
    liabilityRevision: null,
    evidenceRevision: 'repay-evidence-l10-unknown-001',
  });
  const state = run(baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('REPAY_OBSERVED', 3, repayUnknown),
    ],
  }));
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.ok(state.ambiguousMutationRefs.includes('repay:repay-evidence-l10-unknown-001'));
  assert.ok(state.reasonCodes.includes('REPAY_MUTATION_UNKNOWN'));
});

test('valid recovery evidence is bound to L08, collateral and a strictly reduced risk measure', () => {
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
      event('RECOVERY_EVIDENCE', 5, recoveryEvidence(policies)),
    ],
  }));
  assert.equal(state.stage, 'RECOVERING');
  assert.equal(state.recoveryEvidence.length, 1);
  assert.equal(state.recoveryEvidence[0].riskMeasureBefore, '0.03');
  assert.equal(state.recoveryEvidence[0].riskMeasureAfter, '0.01');
});

test('recovery evidence after owner-gate expiry remains fail-closed with its occurrence proof', () => {
  const policies = policySet();
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const futures = orderObservation(policies, 'FUTURES_ENTRY_HEDGE');
  const events = [
    event('BORROW_OBSERVED', 1, confirmedBorrow()),
    event('LIABILITY_OBSERVED', 2, liability()),
    event('ORDER_OBSERVED', 3, margin.payload),
    event('ORDER_OBSERVED', 4, futures.payload),
    event('RECOVERY_EVIDENCE', 5, recoveryEvidence(policies)),
  ];
  const value = baseInput({ policies, events });
  value.preflight.gates[0].validUntilMs = events[4].occurredAtMs - 1;
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.equal(state.recoveryEvidence[0].occurredAtMs, events[4].occurredAtMs);
  assert.ok(state.reasonCodes.some((reason) => reason.startsWith('RECOVERY_GATE_')));
});

test('non-reducing recovery, gross overflow, cost overflow and missing liquidity each fail closed', () => {
  const cases = [
    [{ riskMeasureAfter: '0.03' }, 'RECOVERY_NOT_RISK_REDUCING'],
    [{ grossNotionalAfter: '12.1' }, 'RECOVERY_GROSS_LIMIT_EXCEEDED'],
    [{ recoveryCostQuote: '2.1' }, 'RECOVERY_COST_LIMIT_EXCEEDED'],
    [{ liquidityState: 'UNKNOWN' }, 'RECOVERY_LIQUIDITY_UNKNOWN'],
    [{ collateralRevision: 'collateral-revision-wrong' }, 'RECOVERY_COLLATERAL_REVISION_MISMATCH'],
  ];
  for (const [overrides, reason] of cases) {
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
        event('RECOVERY_EVIDENCE', 5, recoveryEvidence(policies, overrides)),
      ],
    }));
    assert.equal(state.stage, 'RECOVERY_REQUIRED', reason);
    assert.ok(state.reasonCodes.includes(reason), reason);
  }
});

test('manual intervention is an explicit state and never erases debt', () => {
  const state = run(baseInput({
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('MANUAL_INTERVENTION', 3, {
        reasonCode: 'repay-owner-review-required',
        operatorAction: 'Inspect the exact Margin liability and reconcile manually.',
        evidenceRevision: 'manual-intervention-evidence-l10-001',
      }),
    ],
  }));
  assert.equal(state.stage, 'MANUAL_INTERVENTION');
  assert.equal(state.exposure.totalLiability, '0.03');
});

test('L07-backed recovery cover and Futures adjustment can reach RECOVERED only after exact repay', () => {
  const policies = policySet();
  const marginEntry = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const futuresEntry = orderObservation(policies, 'FUTURES_ENTRY_HEDGE');
  const recoveryMargin = orderObservation(policies, 'RECOVERY_MARGIN_COVER', {
    fixtureSuffix: 'recovery-margin',
  });
  const recoveryFutures = orderObservation(policies, 'RECOVERY_FUTURES_ADJUST', {
    fixtureSuffix: 'recovery-futures',
  });
  const marginEvidence = recoveryEvidence(policies, {
    role: 'RECOVERY_MARGIN_COVER',
    recoveryRef: 'recovery-ref-l10-margin-001',
  });
  const futuresEvidence = recoveryEvidence(policies, {
    role: 'RECOVERY_FUTURES_ADJUST',
    recoveryRef: 'recovery-ref-l10-futures-001',
  });
  const zero = liability({
    principal: '0', accruedInterest: '0', totalLiability: '0',
    repayStatus: 'ZERO_CONFIRMED', revision: 'liability-revision-l10-recovery-zero-001',
    observedAtMs: EVALUATED_AT_MS - 50,
  });
  const repay = confirmedRepay({ liabilityRevision: zero.liabilityRevision });
  const observations = [marginEntry, futuresEntry, recoveryMargin, recoveryFutures];
  const events = [
    event('BORROW_OBSERVED', 1, confirmedBorrow()),
    event('LIABILITY_OBSERVED', 2, liability()),
    event('ORDER_OBSERVED', 3, marginEntry.payload),
    event('ORDER_OBSERVED', 4, futuresEntry.payload),
    event('RECOVERY_EVIDENCE', 5, marginEvidence),
    event('RECOVERY_EVIDENCE', 6, futuresEvidence),
    event('ORDER_OBSERVED', 7, recoveryMargin.payload),
    event('ORDER_OBSERVED', 8, recoveryFutures.payload),
    event('REPAY_OBSERVED', 9, repay),
    event('LIABILITY_OBSERVED', 10, zero),
    event('CLOSURE_RECONCILED', 11, {
      state: 'EXACT',
      accountRealmId: MARGIN_REALM,
      liabilityRevision: zero.liabilityRevision,
      borrowTransactionId: 'borrow-transaction-l10-001',
      repayTransactionId: repay.transactionId,
      orderStateRevisions: observations.map((item) => item.order.venueRevision).sort(),
      openOrderRefs: [], ambiguousMutationRefs: [], unmatchedFillRefs: [],
      marginShortRemaining: '0', futuresLongRemaining: '0',
      observedAtMs: EVALUATED_AT_MS - 50,
      validUntilMs: EVALUATED_AT_MS + 10_000,
      reconciliationRevision: 'closure-reconciliation-l10-recovery-001',
    }),
  ];
  const state = run(baseInput({ policies, events }));
  assert.equal(state.stage, 'RECOVERED');
  assert.equal(state.exposure.totalLiability, '0');
  assert.equal(state.orders.filter((order) => order.role.startsWith('RECOVERY_')).length, 2);
  assert.deepEqual(state.reasonCodes, []);
});

test('external manual repayment can reach RECOVERED only with exact zero and exact reconciliation', () => {
  const policies = policySet();
  const rejected = orderObservation(policies, 'MARGIN_ENTRY_SELL', {
    mutationState: 'REJECTED_NO_EFFECT_PROVEN',
    fixtureSuffix: 'manual-repay',
  });
  const zero = liability({
    principal: '0', accruedInterest: '0', totalLiability: '0',
    repayStatus: 'ZERO_CONFIRMED', revision: 'liability-revision-l10-manual-zero-001',
    observedAtMs: EVALUATED_AT_MS - 290,
  });
  const manualRepay = confirmedRepay({
    source: 'EXTERNAL_MANUAL',
    transactionId: 'repay-transaction-l10-external-manual-001',
    liabilityRevision: zero.liabilityRevision,
    evidenceRevision: 'repay-evidence-l10-external-manual-001',
  });
  const events = [
    event('BORROW_OBSERVED', 1, confirmedBorrow()),
    event('LIABILITY_OBSERVED', 2, liability()),
    event('ORDER_OBSERVED', 3, rejected.payload),
    event('REPAY_OBSERVED', 4, manualRepay),
    event('LIABILITY_OBSERVED', 5, zero),
    event('CLOSURE_RECONCILED', 6, {
      state: 'EXACT',
      accountRealmId: MARGIN_REALM,
      liabilityRevision: zero.liabilityRevision,
      borrowTransactionId: 'borrow-transaction-l10-001',
      repayTransactionId: manualRepay.transactionId,
      orderStateRevisions: [rejected.order.venueRevision],
      openOrderRefs: [], ambiguousMutationRefs: [], unmatchedFillRefs: [],
      marginShortRemaining: '0', futuresLongRemaining: '0',
      observedAtMs: EVALUATED_AT_MS - 240,
      validUntilMs: EVALUATED_AT_MS + 10_000,
      reconciliationRevision: 'closure-reconciliation-l10-manual-repay-001',
    }),
  ];
  const state = run(baseInput({ policies, events }));
  assert.equal(state.stage, 'RECOVERED');
  assert.equal(state.exposure.totalLiability, '0');
  assert.deepEqual(state.reasonCodes.filter((reason) => reason.startsWith('CLOSURE_')), []);
});
