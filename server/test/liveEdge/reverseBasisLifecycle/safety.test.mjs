import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalJson } from '../../../dist/foundation/contracts/index.js';
import {
  validateReverseBasisLifecycleState,
} from '../../../dist/liveEdge/adapters/reverseBasisLifecycle/index.js';
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
  run,
  standardLifecycleEvents,
} from './fixtures.mjs';

function replaceEvent(events, index, payload) {
  const prior = events[index];
  events[index] = event(prior.kind, prior.sequence, payload, prior.occurredAtMs);
}

function recomputeStateRevision(state) {
  const { stateRevision: _stateRevision, ...material } = state;
  state.stateRevision = `l10state_${createHash('sha256')
    .update(canonicalJson(material)).digest('hex')}`;
}

test('confirmed borrow outside its transient quote window remains non-terminal', () => {
  const value = closedInput();
  value.preflight.borrowQuote.validUntilMs = value.events[0].occurredAtMs - 1;
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.ok(state.reasonCodes.includes('BORROW_CONFIRMATION_OUTSIDE_QUOTE_WINDOW'));
  assert.notEqual(state.stage, 'CLOSED');
});

test('borrow at or beyond the quoted interest boundary requires a fresh liability quote', () => {
  const value = closedInput();
  value.preflight.borrowQuote.nextInterestAtMs = value.events[0].occurredAtMs;
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.ok(state.reasonCodes.includes('BORROW_INTEREST_BOUNDARY_REQUERY_REQUIRED'));
});

test('owner-gate and collateral expiry between preflight and borrow are sticky', () => {
  for (const mutate of [
    (value) => { value.preflight.gates[0].validUntilMs = value.events[0].occurredAtMs - 1; },
    (value) => { value.preflight.collateral.validUntilMs = value.events[0].occurredAtMs - 1; },
  ]) {
    const value = closedInput();
    mutate(value);
    const state = run(value);
    assert.equal(state.stage, 'RECOVERY_REQUIRED');
    assert.ok(state.reasonCodes.some((reason) => reason.startsWith('BORROW_')));
  }
});

test('owner-gate expiry after borrow but before the first order remains fail-closed', () => {
  const value = closedInput();
  value.preflight.gates[0].validUntilMs = value.events[0].occurredAtMs + 1;
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.ok(state.reasonCodes.some((reason) => reason.startsWith('ORDER_GATE_')));
  assert.notEqual(state.stage, 'CLOSED');
});

test('sequence order cannot disguise regressing occurrence time', () => {
  const value = baseInput({
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow(), EVALUATED_AT_MS - 200),
      event('LIABILITY_OBSERVED', 2, liability({
        observedAtMs: EVALUATED_AT_MS - 310,
      }), EVALUATED_AT_MS - 300),
    ],
  });
  assert.throws(() => run(value), /occurrence time regressed across sequence/);
});

test('repay before flattening and any order after repay are rejected causally', () => {
  const policies = policySet();
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const futures = orderObservation(policies, 'FUTURES_ENTRY_HEDGE');
  const earlyRepay = baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, margin.payload),
      event('ORDER_OBSERVED', 4, futures.payload),
      event('REPAY_OBSERVED', 5, confirmedRepay()),
    ],
  });
  assert.throws(() => run(earlyRepay), /repay requires flat, paired and unambiguous/);

  const afterRepay = baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('REPAY_OBSERVED', 3, confirmedRepay()),
      event('ORDER_OBSERVED', 4, margin.payload),
    ],
  });
  assert.throws(() => run(afterRepay), /order observation cannot follow repay truth/);
});

test('an apparent Margin-only round trip cannot reach repay or closure', () => {
  const policies = policySet();
  const sale = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const cover = orderObservation(policies, 'MARGIN_EXIT_COVER');
  const value = baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, sale.payload),
      event('ORDER_OBSERVED', 5, cover.payload),
    ],
  });
  assert.throws(() => run(value), /normal Margin cover requires a fully hedged open pair/);
});

test('first liability must equal borrow and cannot regress before repay', () => {
  const underreported = baseInput({
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability({
        principal: '0.01', totalLiability: '0.01',
      })),
    ],
  });
  assert.throws(() => run(underreported), /first liability truth does not exactly bind/);

  const regressed = baseInput({
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('LIABILITY_OBSERVED', 3, liability({
        principal: '0.01', totalLiability: '0.01',
        observedAtMs: EVALUATED_AT_MS - 390,
        revision: 'liability-revision-l10-regressed-001',
      })),
    ],
  });
  assert.throws(() => run(regressed), /liability principal or interest regressed/);
});

test('canonical L07 state replay rejects stale nested fill/revision truth', () => {
  const policies = policySet();
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const tampered = structuredClone(margin.payload);
  tampered.twinScenario.orders[0].filledQuantity = '0.02';
  const value = baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, tampered),
    ],
  });
  assert.throws(
    () => run(value),
    /fill sum|state revision mismatch|committed filled quantity|quantity conservation/,
  );
});

test('terminal partial-fill order truth cannot be rewritten as a fresh full fill', () => {
  const policies = policySet();
  const partial = orderObservation(policies, 'MARGIN_ENTRY_SELL', {
    liquidityQuantity: '0.01', fixtureSuffix: 'absorbing-terminal',
  });
  const rewritten = orderObservation(policies, 'MARGIN_ENTRY_SELL', {
    fixtureSuffix: 'absorbing-terminal',
  });
  const value = baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, partial.payload),
      event('ORDER_OBSERVED', 4, rewritten.payload),
    ],
  });
  assert.throws(() => run(value), /terminal order venue\/fill truth is absorbing/);
});

test('canonical L08 input replay rejects a tampered output decision', () => {
  const value = baseInput();
  value.policies.exit.decision.selectedPlan.legs[0].accountRealmId = 'account-realm:foreign-l10';
  assert.throws(() => run(value), /canonical result of its accepted L08 input/);
});

test('borrow quote, collateral and owner gates are bound to exact ticket owners', () => {
  for (const mutate of [
    (value) => { value.preflight.borrowQuote.accountRealmId = 'account-realm:foreign-l10'; },
    (value) => { value.preflight.collateral.accountRealmId = 'account-realm:foreign-l10'; },
    (value) => { value.preflight.gates.find((gate) => gate.kind === 'FOUNDATION_RISK').ownerRevision = 'risk-foreign-l10'; },
  ]) {
    const value = baseInput();
    mutate(value);
    const operation = () => run(value);
    if (value.preflight.gates.some((gate) => gate.ownerRevision === 'risk-foreign-l10')) {
      const state = operation();
      assert.equal(state.stage, 'BLOCKED');
      assert.ok(state.reasonCodes.includes('GATE_FOUNDATION_RISK_OWNER_REVISION_MISMATCH'));
    } else assert.throws(operation, /verified Margin identity/);
  }
});

test('closed runtime schemas reject unknown auth-shaped fields instead of persisting them', () => {
  for (const field of ['accessToken', 'authorization', 'clientSecretValue']) {
    const value = baseInput();
    value.ticket[field] = 'not-a-credential';
    assert.throws(() => run(value), /ticket fields are invalid|secret-shaped fields/, field);
  }
});

test('naked-duration breach remains sticky after a later exact hedge', () => {
  const policies = policySet();
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const futures = orderObservation(policies, 'FUTURES_ENTRY_HEDGE');
  const value = baseInput({ policies });
  value.ticket.maxNakedDurationMs = 1;
  value.events = [
    event('BORROW_OBSERVED', 1, confirmedBorrow()),
    event('LIABILITY_OBSERVED', 2, liability()),
    event('ORDER_OBSERVED', 3, margin.payload),
    event('ORDER_OBSERVED', 4, futures.payload),
  ];
  const state = run(value);
  assert.equal(state.exposure.hedgeDriftQuantity, '0');
  assert.equal(state.nakedRiskLimitBreached, true);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
});

test('closure is final and no later lifecycle evidence may overwrite it', () => {
  const value = closedInput();
  value.events.push(event('MANUAL_INTERVENTION', 10, {
    reasonCode: 'late-evidence-l10',
    operatorAction: 'Reject evidence after closure.',
    evidenceRevision: 'late-evidence-revision-l10',
  }, value.events.at(-1).occurredAtMs));
  assert.throws(() => run(value), /closure reconciliation is final/);
});

test('state validation re-derives liability, repay-basis and exposure safety', () => {
  const state = structuredClone(run(closedInput()));
  state.liability.principal = '0.5';
  state.liability.totalLiability = '0.5';
  recomputeStateRevision(state);
  assert.throws(
    () => validateReverseBasisLifecycleState(state),
    /ZERO_CONFIRMED liability must be exact zero|exposure does not derive/,
  );

  const forgedRepay = structuredClone(run(closedInput()));
  forgedRepay.repay.requestedRepayAmount = '0';
  forgedRepay.repay.confirmedRepayAmount = '0';
  recomputeStateRevision(forgedRepay);
  assert.throws(
    () => validateReverseBasisLifecycleState(forgedRepay),
    /terminal reverse-basis state hides debt, exposure or ambiguity/,
  );
});

test('terminal state replay revalidates repay, closure, owner truth and cross-leg chronology', () => {
  const cases = [
    {
      mutate(state) { state.repay.liabilityRevision = 'liability-revision-foreign-l10'; },
      error: /terminal reverse-basis state hides debt/,
    },
    {
      mutate(state) {
        state.initialLiability.accruedInterest = '0.001';
        state.initialLiability.totalLiability = '0.031';
      },
      error: /liability revision has conflicting content|repay basis regresses initial principal or accrued interest/,
    },
    {
      mutate(state) {
        const entry = state.orders.find((order) => order.role === 'MARGIN_ENTRY_SELL');
        state.initialLiability.validUntilMs = entry.dispatchAtMs - 1;
      },
      error: /liability revision has conflicting content|liability basis window/,
    },
    {
      mutate(state) {
        const entry = state.orders.find((order) => order.role === 'MARGIN_ENTRY_SELL');
        entry.liabilityBasis.validUntilMs = entry.dispatchAtMs - 1;
      },
      error: /liability revision has conflicting content|liability basis window/,
    },
    {
      mutate(state) {
        const entry = state.orders.find((order) => order.role === 'MARGIN_ENTRY_SELL');
        entry.liabilityBasis = {
          ...entry.liabilityBasis,
          principal: '0',
          accruedInterest: '0',
          totalLiability: '0',
          repayStatus: 'ZERO_CONFIRMED',
          liabilityRevision: 'liability-revision-l10-forged-zero-order-basis',
        };
      },
      error: /order liability basis is outside the outstanding borrow chain/,
    },
    {
      mutate(state) {
        state.preflight.gates[0].validUntilMs = state.borrowOccurredAtMs + 1;
      },
      error: /hides an order\/recovery-time owner validation reason/,
    },
    {
      mutate(state) {
        for (const order of state.orders) {
          order.requestedQuantity = '0.04';
          order.filledQuantity = '0.04';
          order.filledNotionalQuote = '4';
          order.remainingQuantity = '0';
          order.expiredQuantity = '0';
        }
        state.exposure.marginSaleFilled = '0.04';
        state.exposure.futuresEntryFilled = '0.04';
        state.exposure.marginCoverFilled = '0.04';
        state.exposure.futuresExitFilled = '0.04';
      },
      error: /order request exceeds confirmed borrowed principal|Margin entry does not exactly bind/,
    },
    {
      mutate(state) { state.ticket.maxNakedQuantity = '0.02'; },
      error: /hides a derived naked-risk or gross-notional limit breach/,
    },
    {
      mutate(state) {
        state.closureEvidence.observedAtMs = state.orders.at(-1).observedAtMs - 1;
      },
      error: /terminal reverse-basis state hides debt/,
    },
    {
      mutate(state) {
        state.lastOrderOccurredAtMs = state.closureEvidence.observedAtMs + 1;
      },
      error: /last-order time does not exactly bind|terminal reverse-basis state hides debt/,
    },
    {
      mutate(state) {
        state.repayOccurredAtMs = state.lastOrderOccurredAtMs - 1;
      },
      error: /terminal reverse-basis state hides debt/,
    },
    {
      mutate(state) {
        state.collateral.liquidationState = 'MARGIN_CALL';
        state.preflight.collateral.liquidationState = 'MARGIN_CALL';
      },
      error: /preflight result does not derive/,
    },
    {
      mutate(state) {
        state.borrowQuote.state = 'UNKNOWN';
        state.preflight.borrowQuote.state = 'UNKNOWN';
      },
      error: /preflight result does not derive/,
    },
    {
      mutate(state) {
        const margin = state.orders.find((order) => order.role === 'MARGIN_ENTRY_SELL');
        const futures = state.orders.find((order) => order.role === 'FUTURES_ENTRY_HEDGE');
        futures.dispatchAtMs = margin.observedAtMs - 1;
      },
      error: /cross-leg chronology is invalid/,
    },
    {
      mutate(state) {
        state.manualIntervention = {
          reasonCode: 'manual-unresolved-l10',
          operatorAction: 'Resolve this intervention before terminal truth.',
          evidenceRevision: 'manual-unresolved-revision-l10',
        };
      },
      error: /manual-intervention stage\/evidence mismatch|terminal reverse-basis/,
    },
  ];
  for (const { mutate, error } of cases) {
    const state = structuredClone(run(closedInput()));
    mutate(state);
    recomputeStateRevision(state);
    assert.throws(() => validateReverseBasisLifecycleState(state), error);
  }
});

test('L07 dispatch chronology binds hedge to the observed Margin fill', () => {
  const policies = policySet();
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const earlyFutures = orderObservation(policies, 'FUTURES_ENTRY_HEDGE', {
    anchorOverrideAtMs: EVALUATED_AT_MS - 430,
    fixtureSuffix: 'early-dispatch',
  });
  const value = baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, margin.payload),
      event('ORDER_OBSERVED', 4, earlyFutures.payload),
    ],
  });
  assert.throws(() => run(value), /hedge (venue effect|dispatch) predates/);
});

test('no event set can erase a newer liability with an older exact closure', () => {
  const value = closedInput();
  const events = standardLifecycleEvents(value.policies);
  const closure = events.at(-1);
  const newerPartial = structuredClone(closure.payload);
  newerPartial.state = 'PARTIAL';
  newerPartial.observedAtMs = closure.payload.observedAtMs + 1;
  value.events = [
    ...events.slice(0, -1),
    event('CLOSURE_RECONCILED', 9, newerPartial, closure.occurredAtMs),
    event('CLOSURE_RECONCILED', 10, closure.payload, closure.occurredAtMs),
  ];
  assert.throws(() => run(value), /closure reconciliation is final/);
});
