import assert from 'node:assert/strict';
import test from 'node:test';

import {
  baseInput,
  confirmedBorrow,
  event,
  liability,
  run,
} from './fixtures.mjs';

function input() {
  return structuredClone(baseInput());
}

test('complete current borrow/collateral/owner truth preflights but does not imply a borrow', () => {
  const state = run(input());
  assert.equal(state.preflightPassed, true);
  assert.equal(state.stage, 'PREFLIGHTED');
  assert.equal(state.borrow, null);
  assert.deepEqual(state.reasonCodes, ['BORROW_CONFIRMATION_MISSING']);
  assert.equal(state.sendEligible, false);
  assert.equal(state.mutationAuthority, 'NONE');
});

test('missing borrow truth fails closed before the construction exists', () => {
  const value = input();
  value.preflight.borrowQuote = null;
  const state = run(value);
  assert.equal(state.stage, 'BLOCKED');
  assert.equal(state.preflightPassed, false);
  assert.ok(state.reasonCodes.includes('BORROW_TRUTH_MISSING'));
});

test('unknown or unavailable borrow truth fails closed', () => {
  for (const stateName of ['UNKNOWN', 'UNAVAILABLE']) {
    const value = input();
    value.preflight.borrowQuote.state = stateName;
    value.preflight.borrowQuote.maximumBorrowable = null;
    value.preflight.borrowQuote.accountBorrowLimit = null;
    value.preflight.borrowQuote.availableInventory = null;
    value.preflight.borrowQuote.hourlyInterestRate = null;
    value.preflight.borrowQuote.interestAccrual = 'UNKNOWN';
    value.preflight.borrowQuote.nextInterestAtMs = null;
    const state = run(value);
    assert.equal(state.stage, 'BLOCKED', stateName);
    assert.ok(state.reasonCodes.includes(`BORROW_TRUTH_${stateName}`), stateName);
    assert.ok(state.reasonCodes.includes('BORROW_TRUTH_INCOMPLETE'), stateName);
  }
});

test('stale transient maximum-borrow quote cannot authorize entry', () => {
  const value = input();
  value.preflight.borrowQuote.validUntilMs = value.preflight.evaluatedAtMs - 1;
  const state = run(value);
  assert.equal(state.stage, 'BLOCKED');
  assert.ok(state.reasonCodes.includes('BORROW_TRUTH_STALE'));
});

test('maximum, account limit and inventory each independently cap borrow', () => {
  const cases = [
    ['maximumBorrowable', 'BORROW_MAXIMUM_INSUFFICIENT'],
    ['accountBorrowLimit', 'BORROW_ACCOUNT_LIMIT_INSUFFICIENT'],
    ['availableInventory', 'BORROW_INVENTORY_INSUFFICIENT'],
  ];
  for (const [field, reason] of cases) {
    const value = input();
    value.preflight.borrowQuote[field] = '0.029';
    const state = run(value);
    assert.equal(state.stage, 'BLOCKED', field);
    assert.ok(state.reasonCodes.includes(reason), field);
  }
});

test('every required owner gate must be present, passing and current', () => {
  const missing = input();
  missing.preflight.gates = missing.preflight.gates.slice(1);
  assert.ok(run(missing).reasonCodes.includes('GATE_BASIS_PROPOSAL_MISSING'));

  const unknown = input();
  unknown.preflight.gates[0].state = 'UNKNOWN';
  assert.ok(run(unknown).reasonCodes.includes('GATE_BASIS_PROPOSAL_UNKNOWN'));

  const stale = input();
  stale.preflight.gates[0].validUntilMs = stale.preflight.evaluatedAtMs - 1;
  assert.ok(run(stale).reasonCodes.includes('GATE_BASIS_PROPOSAL_STALE'));
});

test('collateral and liquidation posture fail closed independently', () => {
  const stale = input();
  stale.preflight.collateral.state = 'STALE';
  assert.ok(run(stale).reasonCodes.includes('COLLATERAL_STALE'));

  const unknown = input();
  unknown.preflight.collateral.marginLevel = null;
  assert.ok(run(unknown).reasonCodes.includes('COLLATERAL_POSTURE_INCOMPLETE'));

  const marginCall = input();
  marginCall.preflight.collateral.liquidationState = 'MARGIN_CALL';
  assert.ok(run(marginCall).reasonCodes.includes('COLLATERAL_LIQUIDATION_MARGIN_CALL'));
});

test('isolated Margin requires its exact isolated symbol and liquidation price', () => {
  const missingPrice = input();
  missingPrice.preflight.collateral.liquidationPrice = null;
  assert.ok(run(missingPrice).reasonCodes.includes('ISOLATED_LIQUIDATION_PRICE_MISSING'));

  const wrongSymbol = input();
  wrongSymbol.ticket.account.isolatedSymbol = 'ETHUSDT';
  assert.throws(() => run(wrongSymbol), /Margin mode and isolated symbol binding disagree/);
});

test('a transfer-requiring account construction is structurally forbidden', () => {
  const value = input();
  value.ticket.account.accountConstruction = 'TRANSFER_REQUIRED';
  value.ticket.account.transferRequired = true;
  assert.throws(() => run(value), /forbidden transfer/);
});

test('USD-M position mode and positionSide must agree exactly', () => {
  const value = input();
  value.ticket.account.futuresPositionMode = 'HEDGE';
  assert.throws(() => run(value), /position mode\/side binding disagrees/);
});

test('missing new-entry borrow truth cannot hide an already confirmed liability as merely blocked', () => {
  const value = input();
  value.preflight.borrowQuote = null;
  value.events = [
    event('BORROW_OBSERVED', 1, confirmedBorrow()),
    event('LIABILITY_OBSERVED', 2, liability()),
  ];
  const state = run(value);
  assert.equal(state.stage, 'RECOVERY_REQUIRED');
  assert.equal(state.exposure.totalLiability, '0.03');
  assert.ok(state.reasonCodes.includes('BORROW_TRUTH_MISSING'));
});

test('an L08 mechanics witness cannot widen send authority', () => {
  const value = input();
  value.policies.entry.decision.sendEligible = true;
  assert.throws(() => run(value), /canonical result|non-sendable L08 plan|widen authority/);
});
