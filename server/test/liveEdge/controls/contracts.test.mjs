import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTROL_LIMITS,
  validateDurableControlAction,
  validatePreviewRequest,
} from '../../../dist/liveEdge/controls/index.js';
import { actions, previewRequest, ref, waitingRef } from './fixtures.mjs';

test('all 18 §21 action discriminants have closed bounded schemas', () => {
  const variants = Object.values(actions);
  assert.equal(variants.length, 18);
  for (const action of variants) {
    const checked = validateDurableControlAction(action);
    assert.equal(checked.ok, true, action.type);
    assert.equal(checked.value.type, action.type);
  }
});

test('generic payload bags and client-supplied actor fields are impossible', () => {
  for (const field of ['payload', 'actor', 'requestedBy', 'operator', 'email']) {
    const request = { ...previewRequest(actions.pause), [field]: 'client-forged' };
    const checked = validatePreviewRequest(request);
    assert.equal(checked.ok, false, field);
    assert.equal(checked.code, 'STRICT_SCHEMA_VIOLATION');
  }
  const action = { ...actions.pause, payload: { arbitrary: true } };
  assert.equal(validateDurableControlAction(action).ok, false);
});

test('configuration values, reduction, TTL, IDs, and free text are bounded', () => {
  const invalid = [
    { ...actions.configuration, change: { ...actions.configuration.change, valueMs: 99 } },
    { ...actions.configuration, change: { ...actions.configuration.change, valueMs: 300_001 } },
    { ...actions.reduce, reductionBps: 0 },
    { ...actions.reduce, reductionBps: 10_001 },
    { ...actions.desired, component: { ...actions.desired.component, id: 'x'.repeat(129) } },
  ];
  for (const action of invalid) assert.equal(validateDurableControlAction(action).ok, false, action.type);
  assert.equal(validatePreviewRequest(previewRequest(actions.pause, { ttlMs: CONTROL_LIMITS.minimumTtlMs - 1 })).ok, false);
  assert.equal(validatePreviewRequest(previewRequest(actions.pause, { ttlMs: CONTROL_LIMITS.maximumTtlMs + 1 })).ok, false);
  assert.equal(validatePreviewRequest(previewRequest(actions.pause, { reason: 'https://remote.invalid/control' })).ok, false);
  assert.equal(validatePreviewRequest(previewRequest(actions.pause, { reason: 'run $(arbitrary-command)' })).ok, false);
  assert.equal(validatePreviewRequest(previewRequest(actions.pause, { reason: 'authorization: bearer abcdefghijklmnop' })).code, 'SENSITIVE_MATERIAL_REJECTED');
});

test('opaque L08 dependencies are exact versioned WAITING-L08 references', () => {
  assert.equal(validateDurableControlAction(actions.recovery).ok, true);
  assert.equal(validateDurableControlAction({
    ...actions.recovery,
    recoveryPlan: { ...waitingRef(), validation: 'OWNER_VALIDATED' },
  }).ok, false);
  assert.equal(validateDurableControlAction({
    ...actions.cancel,
    order: ref('FOUNDATION_EXECUTION'),
  }).ok, false);
});

test('hostile objects fail without invoking accessors or inherited state', () => {
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'type', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'PAUSE_INTAKE';
    },
  });
  Object.defineProperty(accessor, 'scope', { enumerable: true, value: 'NEW_RISK' });
  assert.equal(validateDurableControlAction(accessor).ok, false);
  assert.equal(getterCalls, 0);

  const inherited = Object.create({ type: 'PAUSE_INTAKE' });
  inherited.scope = 'NEW_RISK';
  assert.equal(validateDurableControlAction(inherited).ok, false);

  const symbol = { ...actions.pause };
  symbol[Symbol('hidden')] = true;
  assert.equal(validateDurableControlAction(symbol).ok, false);

  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error('hostile'); } });
  assert.equal(validateDurableControlAction(proxy).ok, false);
});
