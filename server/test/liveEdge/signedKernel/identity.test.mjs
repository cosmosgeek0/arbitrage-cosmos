import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveClientOrderId } from '../../../dist/foundation/contracts/exchange.js';
import { deriveCorrelationId } from '../../../dist/foundation/contracts/identity.js';
import {
  L03_CANONICAL_PAYLOAD_MAX_BYTES,
  L03_REQUEST_ID_MAX_SEQUENCE,
  deriveKernelClientOrderId,
  deriveTransportRequestId,
  fingerprintCanonicalIntent,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/identity.js';

const CANONICAL_PAYLOAD = 'recvWindow=5000&timestamp=1700000007125';
const CANONICAL_FINGERPRINT = '03f9cd2bbdcc77e4405242235fea1995';
const CORRELATION_ID = deriveCorrelationId({ origin: 'l03-test', key: 'identity-0001' });

function identityInput(overrides = {}) {
  return {
    contractId: 'SPOT_ACCOUNT_BALANCES',
    product: 'SPOT',
    environment: 'PRODUCTION',
    signerProfile: 'SPOT_HMAC_SHA256',
    correlationId: CORRELATION_ID,
    requestSequence: 0,
    intentFingerprint: CANONICAL_FINGERPRINT,
    ...overrides,
  };
}

test('canonical-intent fingerprint and request identity have pinned deterministic bytes', () => {
  assert.equal(fingerprintCanonicalIntent(CANONICAL_PAYLOAD), CANONICAL_FINGERPRINT);
  const identity = deriveTransportRequestId(identityInput());
  assert.deepEqual(identity, {
    requestId: 'lrq_2d48ac63ddd09430a1b3a989e21d22a1',
    requestSequence: 0,
    intentFingerprint: CANONICAL_FINGERPRINT,
    correlationId: CORRELATION_ID,
    contractId: 'SPOT_ACCOUNT_BALANCES',
    product: 'SPOT',
    environment: 'PRODUCTION',
    signerProfile: 'SPOT_HMAC_SHA256',
  });
  assert.equal(Object.isFrozen(identity), true);
});

test('request identity is independent of insertion order and domain-separated by every stable field', () => {
  const reordered = {
    intentFingerprint: CANONICAL_FINGERPRINT,
    requestSequence: 0,
    correlationId: CORRELATION_ID,
    signerProfile: 'SPOT_HMAC_SHA256',
    environment: 'PRODUCTION',
    product: 'SPOT',
    contractId: 'SPOT_ACCOUNT_BALANCES',
  };
  const baseline = deriveTransportRequestId(identityInput());
  assert.deepEqual(deriveTransportRequestId(reordered), baseline);

  const variants = [
    identityInput({ contractId: 'SPOT_ACCOUNT_FILTERS' }),
    identityInput({ product: 'USD_M_PERPETUAL', signerProfile: 'USDM_HMAC_SHA256' }),
    identityInput({ correlationId: deriveCorrelationId({ origin: 'l03-test', key: 'identity-0002' }) }),
    identityInput({ requestSequence: 1 }),
    identityInput({ intentFingerprint: '1'.repeat(32) }),
  ].map((input) => deriveTransportRequestId(input).requestId);
  assert.equal(new Set([baseline.requestId, ...variants]).size, variants.length + 1);

  assert.throws(
    () => deriveTransportRequestId(identityInput({ signerProfile: 'USDM_HMAC_SHA256' })),
    /does not match product/,
  );
  assert.throws(
    () => deriveTransportRequestId(identityInput({
      product: 'USD_M_PERPETUAL',
      signerProfile: 'SPOT_HMAC_SHA256',
    })),
    /does not match product/,
  );
});

test('client-order identity delegates exactly to the canonical Foundation owner', () => {
  const cases = [
    {
      input: { planId: 'plan_l03_request_0001', legId: 'leg_l03_spot_open_0001', attempt: 0 },
      expected: 'cx-84319fd5096b0b3d87a35502-0',
    },
    {
      input: { planId: 'plan_l03_request_0001', legId: 'leg_l03_spot_open_0001', attempt: 999 },
      expected: 'cx-ea950bef0083f7fc10f3080d-999',
    },
  ];
  for (const { input, expected } of cases) {
    const canonical = deriveClientOrderId(input);
    assert.equal(canonical, expected);
    assert.equal(deriveKernelClientOrderId(input.planId, input.legId, input.attempt), canonical);
  }
  assert.throws(() => deriveKernelClientOrderId('', 'leg_l03', 0), /planId/);
  assert.throws(() => deriveKernelClientOrderId('plan_l03', 'leg_l03', 1000), /attempt/);
});

test('identity bounds reject empty, oversized, malformed, and unsafe sequence inputs', () => {
  assert.equal(L03_REQUEST_ID_MAX_SEQUENCE, 999_999);
  assert.equal(L03_CANONICAL_PAYLOAD_MAX_BYTES, 8_192);
  assert.throws(() => fingerprintCanonicalIntent(''), /non-empty/);
  assert.equal(fingerprintCanonicalIntent('x'.repeat(8_192)).length, 32);
  assert.throws(() => fingerprintCanonicalIntent('x'.repeat(8_193)), /byte bound/);
  assert.equal(fingerprintCanonicalIntent('é'.repeat(4_096)).length, 32);
  assert.throws(() => fingerprintCanonicalIntent('é'.repeat(4_097)), /byte bound/);

  for (const requestSequence of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER, 1_000_000]) {
    assert.throws(() => deriveTransportRequestId(identityInput({ requestSequence })), /requestSequence/);
  }
  assert.equal(
    deriveTransportRequestId(identityInput({ requestSequence: 999_999 })).requestSequence,
    999_999,
  );
  assert.throws(
    () => deriveTransportRequestId(identityInput({ intentFingerprint: 'A'.repeat(32) })),
    /intentFingerprint/,
  );
  for (const correlationId of ['cor_l03_identity_0001', `cor_${'a'.repeat(32)}`, 'A1'.repeat(32)]) {
    assert.throws(
      () => deriveTransportRequestId(identityInput({ correlationId })),
      /correlationId/,
    );
  }
});

test('identity input rejects unknown, missing, inherited, accessor, and symbol fields without executing values', () => {
  assert.throws(() => deriveTransportRequestId({ ...identityInput(), extra: true }), /closed data record/);
  const missing = identityInput();
  delete missing.contractId;
  assert.throws(() => deriveTransportRequestId(missing), /closed data record/);
  assert.throws(() => deriveTransportRequestId(Object.create(identityInput())), /record/);

  let getterCalls = 0;
  const accessor = identityInput();
  Object.defineProperty(accessor, 'correlationId', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'cor_accessor';
    },
  });
  assert.throws(() => deriveTransportRequestId(accessor), /closed data record/);
  assert.equal(getterCalls, 0);

  const withSymbol = identityInput();
  withSymbol[Symbol('hidden')] = true;
  assert.throws(() => deriveTransportRequestId(withSymbol), /closed data record/);
});

test('active and revoked proxies fail without invoking userland traps', () => {
  const calls = { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 };
  const active = new Proxy(identityInput(), {
    get() { calls.get += 1; throw new Error('proxy get'); },
    getOwnPropertyDescriptor() { calls.getOwnPropertyDescriptor += 1; throw new Error('proxy descriptor'); },
    getPrototypeOf() { calls.getPrototypeOf += 1; throw new Error('proxy prototype'); },
    ownKeys() { calls.ownKeys += 1; throw new Error('proxy keys'); },
  });
  assert.throws(() => deriveTransportRequestId(active), /record/);
  assert.deepEqual(calls, { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 });

  const revoked = Proxy.revocable(identityInput(), {});
  revoked.revoke();
  assert.throws(() => deriveTransportRequestId(revoked.proxy), /record/);
});
