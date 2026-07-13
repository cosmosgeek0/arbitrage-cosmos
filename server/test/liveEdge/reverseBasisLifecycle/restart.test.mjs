import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkpointReverseBasisLifecycle,
  restoreReverseBasisLifecycle,
  validateReverseBasisLifecycleState,
} from '../../../dist/liveEdge/adapters/reverseBasisLifecycle/index.js';
import {
  baseInput,
  closedInput,
  confirmedBorrow,
  event,
  liability,
  orderObservation,
  policySet,
  run,
} from './fixtures.mjs';

test('checkpoint/restore preserves an active liability bit-for-bit', () => {
  const state = run(baseInput({
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
    ],
  }));
  const checkpoint = checkpointReverseBasisLifecycle(state);
  const restored = restoreReverseBasisLifecycle(checkpoint);
  assert.deepEqual(restored, state);
  assert.equal(restored.stateRevision, state.stateRevision);
  assert.equal(restored.exposure.totalLiability, '0.03');
  assert.equal(restored.stage, 'LIABILITY_CONFIRMED');
});

test('checkpoint/restore preserves a fully closed state and its exact proof', () => {
  const state = run(closedInput());
  const checkpoint = checkpointReverseBasisLifecycle(state);
  const restored = restoreReverseBasisLifecycle(checkpoint);
  assert.equal(restored.stage, 'CLOSED');
  assert.equal(restored.stateRevision, state.stateRevision);
  assert.equal(checkpoint.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(checkpoint.externalActionAuthorization, 'NONE');
});

test('tampered checkpoint content is rejected', () => {
  const checkpoint = structuredClone(checkpointReverseBasisLifecycle(run(closedInput())));
  checkpoint.state.stage = 'OPEN';
  assert.throws(() => restoreReverseBasisLifecycle(checkpoint), /checkpoint revision mismatch/);
});

test('tampered checkpoint revision is rejected', () => {
  const checkpoint = structuredClone(checkpointReverseBasisLifecycle(run(closedInput())));
  checkpoint.checkpointRevision = 'l10checkpoint_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.throws(() => restoreReverseBasisLifecycle(checkpoint), /checkpoint revision mismatch/);
});

test('tampered state revision is rejected before it can claim terminal truth', () => {
  const state = structuredClone(run(closedInput()));
  state.stateRevision = 'l10state_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.throws(() => validateReverseBasisLifecycleState(state), /state revision mismatch/);
});

test('ambiguous L07 state survives checkpoint without becoming a failure or no-send claim', () => {
  const policies = policySet();
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  const unknownHedge = orderObservation(policies, 'FUTURES_ENTRY_HEDGE', {
    mutationState: 'UNKNOWN',
    fixtureSuffix: 'restart-unknown',
  });
  const state = run(baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
      event('ORDER_OBSERVED', 3, margin.payload),
      event('ORDER_OBSERVED', 4, unknownHedge.payload),
    ],
  }));
  const restored = restoreReverseBasisLifecycle(checkpointReverseBasisLifecycle(state));
  assert.equal(restored.stage, 'RECOVERY_REQUIRED');
  assert.ok(restored.ambiguousMutationRefs.includes('order-ref-futures-entry-hedge'));
  assert.equal(restored.mutationAuthority, 'NONE');
});

test('adding a later event retains prior event revisions and advances deterministically', () => {
  const policies = policySet();
  const input = baseInput({
    policies,
    events: [
      event('BORROW_OBSERVED', 1, confirmedBorrow()),
      event('LIABILITY_OBSERVED', 2, liability()),
    ],
  });
  const before = run(input);
  const margin = orderObservation(policies, 'MARGIN_ENTRY_SELL');
  input.events.push(event('ORDER_OBSERVED', 3, margin.payload));
  const after = run(input);
  assert.deepEqual(
    after.processedEvents.slice(0, 2).map((item) => item.eventRevision),
    before.processedEvents.map((item) => item.eventRevision),
  );
  assert.equal(before.stage, 'LIABILITY_CONFIRMED');
  assert.equal(after.stage, 'HEDGE_WORKING');
  assert.notEqual(before.stateRevision, after.stateRevision);
});

test('all returned state/checkpoint subgraphs are immutable', () => {
  const state = run(closedInput());
  const checkpoint = checkpointReverseBasisLifecycle(state);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.ticket), true);
  assert.equal(Object.isFrozen(state.orders), true);
  assert.equal(Object.isFrozen(state.orders[0]), true);
  assert.equal(Object.isFrozen(checkpoint), true);
  assert.equal(Object.isFrozen(checkpoint.state), true);
});
