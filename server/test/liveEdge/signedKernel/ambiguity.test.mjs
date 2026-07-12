import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AMBIGUITY_CAUSES,
  NO_DISPATCH_PROOF_CODES,
  REQUEST_ATTEMPT_STAGES,
  createRequestAttempt,
  reduceRequestAttempt,
  requestAttemptMappingGuidance,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/ambiguity.js';

const IDENTITY = Object.freeze({
  requestId: 'lrq_2d48ac63ddd09430a1b3a989e21d22a1',
  clientOrderId: 'cx-84319fd5096b0b3d87a35502-0',
});

function initial() {
  return createRequestAttempt(IDENTITY);
}

function submit(state = initial()) {
  const result = reduceRequestAttempt(state, { kind: 'SUBMIT' });
  assert.equal(result.applied, true);
  return result.state;
}

function observe(event, state = submit()) {
  const result = reduceRequestAttempt(state, { kind: 'TRANSPORT_OBSERVED', ...event });
  assert.equal(result.applied, true);
  return result.state;
}

test('closed initial state accepts only L03 request IDs and Foundation-derived client-order ID forms', () => {
  const state = initial();
  assert.deepEqual(state, {
    schema: 'BINANCE_SIGNED_REQUEST_ATTEMPT_V1',
    version: 1,
    operationClass: 'MUTATION',
    requestId: IDENTITY.requestId,
    clientOrderId: IDENTITY.clientOrderId,
    stage: 'PRE_SEND',
    revision: 0,
    submitCount: 0,
    transportOutcome: null,
    httpStatus: null,
    ambiguityCause: null,
    noDispatchProof: null,
    terminalEvidenceRef: null,
    reconciliationRequired: false,
    duplicateSendBlocked: false,
    automaticResubmission: false,
  });
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(REQUEST_ATTEMPT_STAGES), true);
  assert.equal(Object.isFrozen(NO_DISPATCH_PROOF_CODES), true);
  assert.equal(Object.isFrozen(AMBIGUITY_CAUSES), true);

  for (const clientOrderId of [
    '',
    'bad id',
    'x'.repeat(36),
    'cx-0123456789abcdef0123456g-0',
    'cx-0123456789abcdef01234567-00',
    'cx-0123456789abcdef01234567-1000',
    'A'.repeat(64),
    '../secret',
    '🔥',
  ]) {
    assert.throws(
      () => createRequestAttempt({ ...IDENTITY, clientOrderId }),
      /^TypeError: request attempt identity is invalid$/,
    );
  }
  for (const requestId of [
    '',
    'rq_L03_000000000001',
    `lrq_${'A'.repeat(32)}`,
    `lrq_${'a'.repeat(31)}`,
    'A'.repeat(64),
  ]) {
    assert.throws(
      () => createRequestAttempt({ ...IDENTITY, requestId }),
      /^TypeError: request attempt identity is invalid$/,
    );
  }
  assert.throws(
    () => createRequestAttempt({ ...IDENTITY, unexpected: true }),
    /^TypeError: request attempt identity is invalid$/,
  );
});

test('NOT_SENT requires a closed explicit no-dispatch proof and permits the first actual submit', () => {
  const state = initial();
  for (const event of [
    { kind: 'PROVE_NOT_SENT' },
    { kind: 'PROVE_NOT_SENT', proofCode: 'CALLER_GUESSED_NOT_SENT' },
    { kind: 'PROVE_NOT_SENT', proofCode: 'TRANSPORT_NOT_INVOKED', detail: 'raw secret' },
  ]) {
    const result = reduceRequestAttempt(state, event);
    assert.equal(result.applied, false);
    assert.equal(result.reasonCode, 'EVENT_INVALID');
    assert.notStrictEqual(result.state, state);
    assert.deepEqual(result.state, state);
  }

  const proved = reduceRequestAttempt(state, {
    kind: 'PROVE_NOT_SENT',
    proofCode: 'TRANSPORT_NOT_INVOKED',
  });
  assert.equal(proved.applied, true);
  assert.equal(proved.state.stage, 'NOT_SENT');
  assert.equal(proved.state.noDispatchProof, 'TRANSPORT_NOT_INVOKED');
  assert.equal(proved.state.submitCount, 0);
  assert.equal(proved.state.duplicateSendBlocked, false);

  const submitted = reduceRequestAttempt(proved.state, { kind: 'SUBMIT' });
  assert.equal(submitted.applied, true);
  assert.equal(submitted.state.stage, 'SUBMITTED');
  assert.equal(submitted.state.submitCount, 1);
  assert.equal(submitted.state.noDispatchProof, 'TRANSPORT_NOT_INVOKED');
  assert.equal(submitted.state.duplicateSendBlocked, true);
  assert.equal(submitted.state.automaticResubmission, false);
});

test('timeout, disconnect, HTTP 408, and every 5xx after submit become UNKNOWN without retry advice', () => {
  const cases = [
    [{ outcome: 'TIMEOUT', httpStatus: null, disconnected: false }, 'TRANSPORT_TIMEOUT'],
    [{ outcome: 'AMBIGUOUS', httpStatus: null, disconnected: true }, 'TRANSPORT_DISCONNECTED'],
    [{ outcome: 'REJECTED', httpStatus: 408, disconnected: false }, 'HTTP_408'],
    [{ outcome: 'SUCCESS', httpStatus: 500, disconnected: false }, 'HTTP_5XX'],
    [{ outcome: 'REJECTED', httpStatus: 503, disconnected: false }, 'HTTP_5XX'],
    [{ outcome: 'AMBIGUOUS', httpStatus: 599, disconnected: false }, 'HTTP_5XX'],
  ];
  for (const [event, expectedCause] of cases) {
    const state = observe(event);
    assert.equal(state.stage, 'UNKNOWN');
    assert.equal(state.ambiguityCause, expectedCause);
    assert.equal(state.reconciliationRequired, true);
    assert.equal(state.duplicateSendBlocked, true);
    assert.equal(state.automaticResubmission, false);
    assert.deepEqual(requestAttemptMappingGuidance(state), {
      transportOutcome: event.outcome,
      reconciliationRequired: true,
      queryByDeterministicClientOrderId: true,
      duplicateSendBlocked: true,
      automaticResubmission: false,
      canonicalOwnerGuidance: 'READ_ONLY_QUERY_BY_CLIENT_ORDER_ID',
    });
  }
});

test('ambiguous, aborted, malformed, and incomplete submitted responses fail closed as UNKNOWN', () => {
  const cases = [
    ['AMBIGUOUS', null, 'TRANSPORT_AMBIGUOUS'],
    ['ABORTED', null, 'TRANSPORT_ABORTED_AFTER_DISPATCH'],
    ['MALFORMED', 200, 'MALFORMED_RESPONSE_AFTER_DISPATCH'],
    ['SUCCESS', null, 'INCOMPLETE_SUCCESS_RESPONSE'],
  ];
  for (const [outcome, httpStatus, cause] of cases) {
    const state = observe({ outcome, httpStatus, disconnected: false });
    assert.equal(state.stage, 'UNKNOWN');
    assert.equal(state.ambiguityCause, cause);
  }
});

test('only a proven 2xx success acknowledges and an explicit non-408 4xx rejection rejects', () => {
  const acknowledged = observe({ outcome: 'SUCCESS', httpStatus: 200, disconnected: false });
  assert.equal(acknowledged.stage, 'ACKNOWLEDGED');
  assert.equal(acknowledged.transportOutcome, 'SUCCESS');
  assert.equal(acknowledged.reconciliationRequired, false);
  assert.equal(acknowledged.duplicateSendBlocked, true);

  const rejected = observe({ outcome: 'REJECTED', httpStatus: 400, disconnected: false });
  assert.equal(rejected.stage, 'REJECTED');
  assert.equal(rejected.transportOutcome, 'REJECTED');
  assert.equal(rejected.reconciliationRequired, false);
  assert.equal(rejected.duplicateSendBlocked, true);

  const contradictory = reduceRequestAttempt(submit(), {
    kind: 'TRANSPORT_OBSERVED',
    outcome: 'REJECTED',
    httpStatus: 200,
    disconnected: false,
  });
  assert.equal(contradictory.applied, false);
  assert.equal(contradictory.reasonCode, 'EVENT_INVALID');
});

test('every post-submit stage rejects a second submit byte-for-byte unchanged', () => {
  const submitted = submit();
  const acknowledged = observe({ outcome: 'SUCCESS', httpStatus: 201, disconnected: false });
  const rejected = observe({ outcome: 'REJECTED', httpStatus: 429, disconnected: false });
  const unknown = observe({ outcome: 'TIMEOUT', httpStatus: null, disconnected: false });
  const terminalResult = reduceRequestAttempt(unknown, {
    kind: 'TERMINAL_EVIDENCE_REFERENCED',
    evidenceRef: 'recon.owner_receipt:0001',
  });
  assert.equal(terminalResult.applied, true);

  for (const state of [submitted, acknowledged, rejected, unknown, terminalResult.state]) {
    const before = JSON.stringify(state);
    const result = reduceRequestAttempt(state, { kind: 'SUBMIT' });
    assert.equal(result.applied, false);
    assert.equal(result.reasonCode, 'DUPLICATE_SUBMIT_BLOCKED');
    assert.notStrictEqual(result.state, state);
    assert.equal(JSON.stringify(result.state), before);
  }
});

test('a terminal evidence reference is only a hand-off candidate and cannot clear ambiguity', () => {
  const unknown = observe({ outcome: 'TIMEOUT', httpStatus: null, disconnected: false });
  for (const event of [
    { kind: 'TERMINAL_EVIDENCE_REFERENCED' },
    { kind: 'TERMINAL_EVIDENCE_REFERENCED', evidenceRef: 'bad ref space' },
    { kind: 'TERMINAL_EVIDENCE_REFERENCED', evidenceRef: 'A'.repeat(64) },
    { kind: 'TERMINAL_EVIDENCE_REFERENCED', evidenceRef: 'receipt:1', status: 'EXACT' },
  ]) {
    const result = reduceRequestAttempt(unknown, event);
    assert.equal(result.applied, false);
    assert.notStrictEqual(result.state, unknown);
    assert.deepEqual(result.state, unknown);
  }

  const result = reduceRequestAttempt(unknown, {
    kind: 'TERMINAL_EVIDENCE_REFERENCED',
    evidenceRef: 'foundation.reconciliation:receipt-0001',
  });
  assert.equal(result.applied, true);
  assert.equal(result.state.stage, 'TERMINAL_OBSERVED');
  assert.equal(result.state.reconciliationRequired, true);
  assert.equal(result.state.duplicateSendBlocked, true);
  assert.equal(result.state.automaticResubmission, false);
  assert.equal(result.state.ambiguityCause, 'TRANSPORT_TIMEOUT');
  assert.deepEqual(requestAttemptMappingGuidance(result.state), {
    transportOutcome: 'TIMEOUT',
    reconciliationRequired: true,
    queryByDeterministicClientOrderId: true,
    duplicateSendBlocked: true,
    automaticResubmission: false,
    canonicalOwnerGuidance: 'HAND_OFF_TERMINAL_OBSERVATION',
  });
  assert.equal('status' in result.state, false);
  assert.equal('executionEvent' in result.state, false);
  assert.deepEqual(
    reduceRequestAttempt({ ...result.state, reconciliationRequired: false }, { kind: 'SUBMIT' }),
    { applied: false, state: null, reasonCode: 'STATE_INVALID' },
    'an evidence reference cannot be forged into ambiguity resolution',
  );
});

test('accessors, inherited fields, hostile proxies, revoked proxies, symbols, and unknown fields fail closed', () => {
  const state = initial();
  const accessorEvent = {};
  Object.defineProperty(accessorEvent, 'kind', { enumerable: true, get: () => 'SUBMIT' });
  assert.deepEqual(reduceRequestAttempt(state, accessorEvent), {
    applied: false,
    state,
    reasonCode: 'EVENT_INVALID',
  });

  const inheritedEvent = Object.create({ kind: 'SUBMIT' });
  assert.equal(reduceRequestAttempt(state, inheritedEvent).reasonCode, 'EVENT_INVALID');
  assert.equal(reduceRequestAttempt(state, { kind: 'SUBMIT', extra: true }).reasonCode, 'EVENT_INVALID');
  const symbolEvent = { kind: 'SUBMIT', [Symbol('hidden')]: true };
  assert.equal(reduceRequestAttempt(state, symbolEvent).reasonCode, 'EVENT_INVALID');

  let activeProxyTrapCount = 0;
  const throwingEvent = new Proxy({ kind: 'SUBMIT' }, {
    get() {
      activeProxyTrapCount += 1;
      throw new Error('proxy get trap must not run');
    },
    getPrototypeOf() {
      activeProxyTrapCount += 1;
      throw new Error('proxy prototype trap must not run');
    },
    ownKeys() {
      activeProxyTrapCount += 1;
      throw new Error('proxy ownKeys trap must not run');
    },
    getOwnPropertyDescriptor() {
      activeProxyTrapCount += 1;
      throw new Error('proxy descriptor trap must not run');
    },
  });
  assert.equal(reduceRequestAttempt(state, throwingEvent).reasonCode, 'EVENT_INVALID');
  assert.equal(activeProxyTrapCount, 0, 'active proxies must be rejected without invoking a trap');

  const target = { ...state };
  Object.defineProperty(target, 'stage', { enumerable: true, get: () => 'PRE_SEND' });
  const invalidState = reduceRequestAttempt(target, { kind: 'SUBMIT' });
  assert.deepEqual(invalidState, { applied: false, state: null, reasonCode: 'STATE_INVALID' });

  const { proxy, revoke } = Proxy.revocable({ ...state }, {});
  revoke();
  assert.deepEqual(reduceRequestAttempt(proxy, { kind: 'SUBMIT' }), {
    applied: false,
    state: null,
    reasonCode: 'STATE_INVALID',
  });
});

test('validated mutable states are returned only as canonical frozen snapshots', () => {
  const canonical = initial();
  const mutableSource = { ...canonical };
  Object.defineProperty(mutableSource, 'stage', {
    configurable: true,
    enumerable: false,
    value: 'PRE_SEND',
    writable: true,
  });

  const result = reduceRequestAttempt(mutableSource, { kind: 'UNSUPPORTED' });
  assert.equal(result.applied, false);
  assert.equal(result.reasonCode, 'EVENT_INVALID');
  assert.equal(Object.isFrozen(result), true);
  assert.notStrictEqual(result.state, mutableSource);
  assert.equal(Object.isFrozen(result.state), true);
  assert.deepEqual(Object.keys(result.state), Object.keys(canonical));
  assert.equal(result.state.stage, 'PRE_SEND');

  mutableSource.requestId = 'rq_mutated_after_rejection';
  mutableSource.stage = 'NOT_SENT';
  assert.equal(result.state.requestId, IDENTITY.requestId);
  assert.equal(result.state.stage, 'PRE_SEND');
});

test('invalid transport shapes and illegal transitions are inert', () => {
  const state = initial();
  const events = [
    { kind: 'TRANSPORT_OBSERVED', outcome: 'LOST', httpStatus: null, disconnected: false },
    { kind: 'TRANSPORT_OBSERVED', outcome: 'TIMEOUT', httpStatus: 99, disconnected: false },
    { kind: 'TRANSPORT_OBSERVED', outcome: 'TIMEOUT', httpStatus: null, disconnected: 'yes' },
    { kind: 'TRANSPORT_OBSERVED', outcome: 'TIMEOUT', httpStatus: null, disconnected: false, rawUrl: 'https://secret.invalid' },
  ];
  for (const event of events) {
    const result = reduceRequestAttempt(state, event);
    assert.equal(result.applied, false);
    assert.equal(result.reasonCode, 'EVENT_INVALID');
    assert.notStrictEqual(result.state, state);
    assert.deepEqual(result.state, state);
  }

  const wellFormedButEarly = reduceRequestAttempt(state, {
    kind: 'TRANSPORT_OBSERVED',
    outcome: 'SUCCESS',
    httpStatus: 200,
    disconnected: false,
  });
  assert.equal(wellFormedButEarly.applied, false);
  assert.equal(wellFormedButEarly.reasonCode, 'TRANSITION_NOT_ALLOWED');

  const bounded = Object.freeze({ ...state, revision: 1_000_000 });
  const overBound = reduceRequestAttempt(bounded, { kind: 'SUBMIT' });
  assert.equal(overBound.applied, false);
  assert.equal(overBound.reasonCode, 'STATE_BOUND');
  assert.equal(overBound.state.revision, 1_000_000);
});
