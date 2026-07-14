import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { deriveCorrelationId } from '../../../dist/foundation/contracts/identity.js';
import {
  L03_MAXIMUM_PARAMETERS,
  L03_MAXIMUM_PARAMETER_VALUE_BYTES,
  constructSignedRequest,
  constructUnsignedRequest,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/request.js';
import {
  createRequestAttempt,
  reduceRequestAttempt,
  requestAttemptMappingGuidance,
} from '../../../dist/liveEdge/adapters/binanceSignedKernel/ambiguity.js';
import { projectSafeDiagnostic } from '../../../dist/liveEdge/adapters/binanceSignedKernel/safety.js';

const UTC_ORIGIN_MS = 1_700_000_000_000;
const NOW_MONOTONIC_MS = 7_100;
const VECTOR_SIGNATURE = '39e71c7db0e9d5d7f588e096e827e445392ca4391879352aca987ea7337b2c21';
const VECTOR_PAYLOAD = 'note=caf%C3%A9%20%2B%20%2F&omitZeroBalances=true&recvWindow=5000&timestamp=1700000007125';
const CANONICAL_CANCEL_CLIENT_ORDER_ID = 'cx-84319fd5096b0b3d87a35502-0';
const REQUEST_CORRELATION_ID = deriveCorrelationId({ origin: 'liveEdge.l03.test', key: 'request.0001' });
const SPOT_CANCEL_CORRELATION_ID = deriveCorrelationId({ origin: 'liveEdge.l03.test', key: 'cancel.spot.0001' });
const USDM_CANCEL_CORRELATION_ID = deriveCorrelationId({ origin: 'liveEdge.l03.test', key: 'cancel.usdm.0001' });
const USDM_REQUEST_CORRELATION_ID = deriveCorrelationId({ origin: 'liveEdge.l03.test', key: 'request.usdm.0001' });

// Public illustrative vectors from the current official Binance Spot REST
// and USD-M General Info pages. These published values are non-credentials;
// no private, environment, or operator key enters the fixture.
const OFFICIAL_PUBLIC_HMAC_VECTORS = Object.freeze([
  Object.freeze({
    product: 'SPOT',
    illustrativeKey: 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j',
    payload: 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559',
    digest: 'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71',
  }),
  Object.freeze({
    product: 'USD_M_PERPETUAL',
    illustrativeKey: '2b5eb11e18796d12d88f13dc27dbbd02c2cc51ff7059765ed9821957d82bb4d9',
    payload: 'symbol=BTCUSDT&side=BUY&type=LIMIT&quantity=1&price=9000&timeInForce=GTC&recvWindow=5000&timestamp=1591702613943',
    digest: '3c661234138461fcc7a7d8746c6558c9842d4e10870d2ecbedf7777cad694af9',
  }),
]);

function clockSample(index, product = 'SPOT') {
  const monotonicSendMs = 1_000 + (index * 3_000);
  const monotonicReceiveMs = monotonicSendMs + 100;
  const utcSendEpochMs = UTC_ORIGIN_MS + monotonicSendMs;
  const utcReceiveEpochMs = UTC_ORIGIN_MS + monotonicReceiveMs;
  return {
    product,
    environment: 'PRODUCTION',
    utcSendEpochMs,
    utcReceiveEpochMs,
    monotonicSendMs,
    monotonicReceiveMs,
    serverEpochMs: utcSendEpochMs + 75,
  };
}

function clockSamples(product = 'SPOT') {
  return [0, 1, 2].map((index) => clockSample(index, product));
}

function accountInput(overrides = {}) {
  return {
    contractId: 'SPOT_ACCOUNT_BALANCES',
    expectedProduct: 'SPOT',
    expectedEnvironment: 'PRODUCTION',
    parameters: [],
    clockSamples: clockSamples('SPOT'),
    nowMonotonicMs: NOW_MONOTONIC_MS,
    correlationId: REQUEST_CORRELATION_ID,
    requestSequence: 7,
    clientOrderIdentity: null,
    ...overrides,
  };
}

function orderInput(overrides = {}) {
  return accountInput({
    contractId: 'SPOT_ORDER_POST',
    parameters: [
      ['symbol', 'BTCUSDT'],
      ['side', 'BUY'],
      ['type', 'MARKET'],
      ['quantity', '0.01000000'],
    ],
    clientOrderIdentity: {
      planId: 'plan_l03_request_0001',
      legId: 'leg_l03_spot_open_0001',
      attempt: 0,
    },
    ...overrides,
  });
}

function cancelInput(product = 'SPOT', overrides = {}) {
  const usdm = product === 'USD_M_PERPETUAL';
  return accountInput({
    contractId: usdm ? 'USDM_ORDER_CANCEL' : 'SPOT_ORDER_CANCEL',
    expectedProduct: product,
    parameters: [
      ['symbol', 'BTCUSDT'],
      ['origClientOrderId', CANONICAL_CANCEL_CLIENT_ORDER_ID],
    ],
    clockSamples: clockSamples(product),
    correlationId: usdm ? USDM_CANCEL_CORRELATION_ID : SPOT_CANCEL_CORRELATION_ID,
    requestSequence: usdm ? 12 : 11,
    clientOrderIdentity: null,
    ...overrides,
  });
}

function signer(overrides = {}) {
  return {
    algorithm: 'HMAC_SHA256',
    profile: 'SPOT_HMAC_SHA256',
    product: 'SPOT',
    environment: 'PRODUCTION',
    sign: () => 'a'.repeat(64),
    ...overrides,
  };
}

function expectFailure(result, code) {
  assert.deepEqual(result, { ok: false, failure: { code } });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.failure), true);
}

function assertDeeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) assertDeeplyFrozen(descriptor.value, seen);
  }
}

test('current official public Spot and USD-M HMAC vectors pass without real credentials', () => {
  for (const fixture of OFFICIAL_PUBLIC_HMAC_VECTORS) {
    const actual = createHmac('sha256', fixture.illustrativeKey)
      .update(fixture.payload, 'utf8')
      .digest('hex');
    assert.equal(actual, fixture.digest, `${fixture.product} official vector drifted`);
  }
  assertDeeplyFrozen(OFFICIAL_PUBLIC_HMAC_VECTORS);
});

test('unsigned construction independently runs every gate and emits exact classified canonical bytes', () => {
  const parameters = [
    ['omitZeroBalances', 'true'],
    ['note', 'café + /'],
  ];
  const unsigned = constructUnsignedRequest(accountInput({ parameters }));
  assert.equal(unsigned.ok, true);
  assert.deepEqual(unsigned.request.material, {
    classification: 'SENSITIVE_UNSIGNED_REQUEST_MATERIAL',
    query: VECTOR_PAYLOAD,
  });
  assert.equal(unsigned.request.clientOrderId, null);
  assert.equal(unsigned.request.documentaryAuthority, 'DOCUMENTARY_EVIDENCE_ONLY');
  assert.equal(unsigned.request.externalActionAuthorization, 'NONE');
  assert.equal(unsigned.request.actionAuthority, 'NONE_RECORD_ONLY');
  assertDeeplyFrozen(unsigned);

  let signerCalls = 0;
  const signed = constructSignedRequest(accountInput({ parameters }), signer({
    sign(payload) {
      signerCalls += 1;
      assert.ok(payload === unsigned.request.material.query, 'signed stage did not rerun canonical construction');
      return VECTOR_SIGNATURE;
    },
  }));
  assert.equal(signed.ok, true);
  assert.equal(signerCalls, 1);
  assert.deepEqual(signed.request.requestIdentity, unsigned.request.requestIdentity);
  assert.ok(signed.request.material.query === `${unsigned.request.material.query}&signature=${VECTOR_SIGNATURE}`);
});

test('signed construction accepts no caller-forged prepared request or unsigned payload surface', () => {
  const unsigned = constructUnsignedRequest(accountInput());
  assert.equal(unsigned.ok, true);

  let signerCalls = 0;
  const noCallSigner = signer({ sign() { signerCalls += 1; return 'a'.repeat(64); } });
  expectFailure(
    constructSignedRequest({
      ...accountInput(),
      preparedQuery: unsigned.request.material.query,
    }, noCallSigner),
    'INPUT_INVALID',
  );
  expectFailure(constructSignedRequest(unsigned.request, noCallSigner), 'INPUT_INVALID');
  assert.equal(signerCalls, 0);
});

test('canonical Spot bytes are literal, insertion-order independent, and signed exactly once', () => {
  const seen = [];
  const vectorSigner = signer({
    sign(payload) {
      seen.push(payload);
      assert.ok(payload === VECTOR_PAYLOAD, 'canonical Spot vector bytes changed');
      return VECTOR_SIGNATURE;
    },
  });
  const parameters = [
    ['omitZeroBalances', 'true'],
    ['note', 'café + /'],
  ];
  const forward = constructSignedRequest(accountInput({ parameters }), vectorSigner);
  const reverse = constructSignedRequest(accountInput({ parameters: [...parameters].reverse() }), vectorSigner);

  assert.equal(forward.ok, true);
  assert.equal(reverse.ok, true);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((payload) => payload === VECTOR_PAYLOAD), 'signer observed noncanonical bytes');
  const expectedQuery = `${VECTOR_PAYLOAD}&signature=${VECTOR_SIGNATURE}`;
  assert.ok(forward.request.material.query === expectedQuery, 'signed query bytes changed');
  assert.ok(reverse.request.material.query === expectedQuery, 'parameter insertion order changed signed bytes');
  assert.equal(forward.request.requestIdentity.requestId, reverse.request.requestIdentity.requestId);
  assert.equal(forward.request.requestIdentity.intentFingerprint, reverse.request.requestIdentity.intentFingerprint);
  assert.equal(forward.request.documentaryAuthority, 'DOCUMENTARY_EVIDENCE_ONLY');
  assert.equal(forward.request.externalActionAuthorization, 'NONE');
  assert.equal(forward.request.actionAuthority, 'NONE_RECORD_ONLY');
  assert.equal(forward.request.clientOrderId, null);
  assert.equal('baseUrl' in forward.request, false);
  assert.equal('path' in forward.request, false);
  assertDeeplyFrozen(forward);
});

test('order construction preserves exact decimals and delegates deterministic client-order identity', () => {
  const expectedClientOrderId = 'cx-84319fd5096b0b3d87a35502-0';
  const expectedPayload = [
    `newClientOrderId=${expectedClientOrderId}`,
    'quantity=0.01000000',
    'recvWindow=5000',
    'side=BUY',
    'symbol=BTCUSDT',
    'timestamp=1700000007125',
    'type=MARKET',
  ].join('&');
  let calls = 0;
  const result = constructSignedRequest(orderInput(), signer({
    sign(payload) {
      calls += 1;
      assert.ok(payload === expectedPayload, 'order payload or exact decimal bytes changed');
      return 'a3a770b8663b2f35292af9f204db4f813cc5c48d506229ec7148ae3248ad6d06';
    },
  }));

  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(result.request.clientOrderId, expectedClientOrderId);
  assert.equal(result.request.mutationClass, 'ORDER_MUTATION');
  assert.equal(result.request.safeRetryClass, 'RECONCILE_BEFORE_RETRY');
  assert.ok(result.request.material.query.startsWith(`${expectedPayload}&signature=`));
  assert.equal(result.request.material.query.includes('quantity=0.01&'), false);
});

test('large, small, and trailing-zero decimal strings are never converted through binary numbers', () => {
  const expectedPayload = [
    'largeDecimal=9007199254740993.00000000',
    'recvWindow=5000',
    'smallDecimal=0.00000001',
    'timestamp=1700000007125',
    'trailingDecimal=10.00000000',
  ].join('&');
  let calls = 0;
  const result = constructSignedRequest(accountInput({
    parameters: [
      ['trailingDecimal', '10.00000000'],
      ['smallDecimal', '0.00000001'],
      ['largeDecimal', '9007199254740993.00000000'],
    ],
  }), signer({
    sign(payload) {
      calls += 1;
      assert.ok(payload === expectedPayload, 'exact decimal text changed before signing');
      return 'c'.repeat(64);
    },
  }));
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.ok(result.request.material.query.startsWith(expectedPayload));
});

test('USD-M construction is bound to the USD-M signer profile and exact product clock', () => {
  const input = accountInput({
    contractId: 'USDM_ACCOUNT_V3',
    expectedProduct: 'USD_M_PERPETUAL',
    parameters: [],
    clockSamples: clockSamples('USD_M_PERPETUAL'),
    correlationId: USDM_REQUEST_CORRELATION_ID,
    clientOrderIdentity: null,
  });
  let calls = 0;
  const result = constructSignedRequest(input, signer({
    profile: 'USDM_HMAC_SHA256',
    product: 'USD_M_PERPETUAL',
    sign(payload) {
      calls += 1;
      assert.ok(
        payload === 'recvWindow=5000&timestamp=1700000007125',
        'USD-M canonical bytes changed',
      );
      return 'b'.repeat(64);
    },
  }));
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(result.request.product, 'USD_M_PERPETUAL');
  assert.equal(result.request.signerProfile, 'USDM_HMAC_SHA256');
  assert.equal(result.request.method, 'GET');
});

test('Spot and USD-M cancel construction bind exact origClientOrderId without injecting newClientOrderId', async (t) => {
  for (const product of ['SPOT', 'USD_M_PERPETUAL']) {
    await t.test(product, () => {
      const expectedPayload = [
        `origClientOrderId=${CANONICAL_CANCEL_CLIENT_ORDER_ID}`,
        'recvWindow=5000',
        'symbol=BTCUSDT',
        'timestamp=1700000007125',
      ].join('&');
      const input = cancelInput(product);
      const unsigned = constructUnsignedRequest(input);
      assert.equal(unsigned.ok, true);
      assert.equal(unsigned.request.clientOrderId, CANONICAL_CANCEL_CLIENT_ORDER_ID);
      assert.equal(unsigned.request.method, 'DELETE');
      assert.equal(unsigned.request.mutationClass, 'ORDER_CANCEL_MUTATION');
      assert.ok(unsigned.request.material.query === expectedPayload, `${product} unsigned cancel bytes changed`);
      assert.equal(unsigned.request.material.query.includes('newClientOrderId'), false);

      let calls = 0;
      const productSigner = signer({
        profile: product === 'SPOT' ? 'SPOT_HMAC_SHA256' : 'USDM_HMAC_SHA256',
        product,
        sign(payload) {
          calls += 1;
          assert.ok(payload === expectedPayload, `${product} cancel signer bytes changed`);
          return product === 'SPOT' ? 'd'.repeat(64) : 'e'.repeat(64);
        },
      });
      const signed = constructSignedRequest(input, productSigner);
      assert.equal(signed.ok, true);
      assert.equal(calls, 1);
      assert.equal(signed.request.clientOrderId, CANONICAL_CANCEL_CLIENT_ORDER_ID);
      assert.equal(signed.request.material.query.includes('newClientOrderId'), false);
      assert.ok(signed.request.material.query.startsWith(`${expectedPayload}&signature=`));
    });
  }
});

test('cancel construction blocks numeric-only, ambiguous, noncanonical, and caller-rederived identity selectors', async (t) => {
  const cases = [
    {
      name: 'numeric orderId only',
      parameters: [['symbol', 'BTCUSDT'], ['orderId', '12345']],
      clientOrderIdentity: null,
      code: 'CANCEL_CLIENT_ORDER_ID_REQUIRED',
    },
    {
      name: 'both selectors',
      parameters: [['symbol', 'BTCUSDT'], ['orderId', '12345'], ['origClientOrderId', CANONICAL_CANCEL_CLIENT_ORDER_ID]],
      clientOrderIdentity: null,
      code: 'CANCEL_CLIENT_ORDER_ID_REQUIRED',
    },
    {
      name: 'noncanonical client ID',
      parameters: [['symbol', 'BTCUSDT'], ['origClientOrderId', 'caller-safe-looking-id']],
      clientOrderIdentity: null,
      code: 'CANCEL_CLIENT_ORDER_ID_INVALID',
    },
    {
      name: 'uppercase digest is not canonical owner output',
      parameters: [['symbol', 'BTCUSDT'], ['origClientOrderId', 'cx-84319FD5096B0B3D87A35502-0']],
      clientOrderIdentity: null,
      code: 'CANCEL_CLIENT_ORDER_ID_INVALID',
    },
    {
      name: 'cancel cannot derive a new identity',
      parameters: [['symbol', 'BTCUSDT'], ['origClientOrderId', CANONICAL_CANCEL_CLIENT_ORDER_ID]],
      clientOrderIdentity: { planId: 'plan_l03_request_0001', legId: 'leg_l03_spot_open_0001', attempt: 0 },
      code: 'CLIENT_ORDER_IDENTITY_FORBIDDEN',
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      expectFailure(
        constructUnsignedRequest(cancelInput('SPOT', {
          parameters: fixture.parameters,
          clientOrderIdentity: fixture.clientOrderIdentity,
        })),
        fixture.code,
      );
      let calls = 0;
      expectFailure(
        constructSignedRequest(cancelInput('SPOT', {
          parameters: fixture.parameters,
          clientOrderIdentity: fixture.clientOrderIdentity,
        }), signer({ sign() { calls += 1; return 'a'.repeat(64); } })),
        fixture.code,
      );
      assert.equal(calls, 0);
    });
  }
});

test('cancel-all and countdown-cancel contracts with no per-order identity remain unconstructable', async (t) => {
  const cases = [
    {
      contractId: 'USDM_CANCEL_ALL_OPEN_ORDERS',
      parameters: [['symbol', 'BTCUSDT']],
    },
    {
      contractId: 'USDM_COUNTDOWN_CANCEL_ALL',
      parameters: [['symbol', 'BTCUSDT'], ['countdownTime', '5000']],
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.contractId, () => {
      const input = accountInput({
        contractId: fixture.contractId,
        expectedProduct: 'USD_M_PERPETUAL',
        parameters: fixture.parameters,
        clockSamples: clockSamples('USD_M_PERPETUAL'),
        correlationId: USDM_CANCEL_CORRELATION_ID,
        clientOrderIdentity: null,
      });
      const unsigned = constructUnsignedRequest(input);
      expectFailure(unsigned, 'CANCEL_CONTRACT_IDENTITY_UNRESOLVED');
      assert.equal('request' in unsigned, false);

      let calls = 0;
      const signed = constructSignedRequest(input, signer({
        profile: 'USDM_HMAC_SHA256',
        product: 'USD_M_PERPETUAL',
        sign() { calls += 1; return 'a'.repeat(64); },
      }));
      expectFailure(signed, 'CANCEL_CONTRACT_IDENTITY_UNRESOLVED');
      assert.equal('request' in signed, false);
      assert.equal(calls, 0);
    });
  }
});

test('constructed cancel identities become ambiguity state and mechanically block timeout/5xx resubmission', async (t) => {
  const cases = [
    {
      name: 'Spot timeout',
      product: 'SPOT',
      signer: signer({ sign: () => 'd'.repeat(64) }),
      observation: { kind: 'TRANSPORT_OBSERVED', outcome: 'TIMEOUT', httpStatus: null, disconnected: false },
      cause: 'TRANSPORT_TIMEOUT',
    },
    {
      name: 'USD-M HTTP 503',
      product: 'USD_M_PERPETUAL',
      signer: signer({ profile: 'USDM_HMAC_SHA256', product: 'USD_M_PERPETUAL', sign: () => 'e'.repeat(64) }),
      observation: { kind: 'TRANSPORT_OBSERVED', outcome: 'AMBIGUOUS', httpStatus: 503, disconnected: false },
      cause: 'HTTP_5XX',
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const constructed = constructSignedRequest(cancelInput(fixture.product), fixture.signer);
      assert.equal(constructed.ok, true);
      const attempt = createRequestAttempt({
        requestId: constructed.request.requestIdentity.requestId,
        clientOrderId: constructed.request.clientOrderId,
      });
      const submitted = reduceRequestAttempt(attempt, { kind: 'SUBMIT' });
      assert.equal(submitted.applied, true);
      assert.equal(submitted.state.stage, 'SUBMITTED');
      assert.equal(submitted.state.submitCount, 1);

      const ambiguous = reduceRequestAttempt(submitted.state, fixture.observation);
      assert.equal(ambiguous.applied, true);
      assert.equal(ambiguous.state.stage, 'UNKNOWN');
      assert.equal(ambiguous.state.ambiguityCause, fixture.cause);
      assert.equal(ambiguous.state.clientOrderId, constructed.request.clientOrderId);
      assert.equal(ambiguous.state.reconciliationRequired, true);
      assert.equal(ambiguous.state.duplicateSendBlocked, true);
      assert.equal(ambiguous.state.automaticResubmission, false);

      const beforeDuplicate = JSON.stringify(ambiguous.state);
      const duplicate = reduceRequestAttempt(ambiguous.state, { kind: 'SUBMIT' });
      assert.equal(duplicate.applied, false);
      assert.equal(duplicate.reasonCode, 'DUPLICATE_SUBMIT_BLOCKED');
      assert.equal(JSON.stringify(duplicate.state), beforeDuplicate);
      assert.deepEqual(requestAttemptMappingGuidance(ambiguous.state), {
        transportOutcome: fixture.observation.outcome,
        reconciliationRequired: true,
        queryByDeterministicClientOrderId: true,
        duplicateSendBlocked: true,
        automaticResubmission: false,
        canonicalOwnerGuidance: 'READ_ONLY_QUERY_BY_CLIENT_ORDER_ID',
      });
    });
  }
});

test('contract, parameter, client identity, clock, and request identity gates make zero signer calls', async (t) => {
  const cases = [
    ['unknown contract', accountInput({ contractId: 'SPOT_NOT_REGISTERED' }), 'CONTRACT_NOT_FOUND'],
    ['cross-product contract', accountInput({ contractId: 'USDM_ACCOUNT_V3' }), 'CONTRACT_SCOPE_MISMATCH'],
    ['WebSocket contract', accountInput({ contractId: 'SPOT_WS_API_USER_DATA_SIGNATURE' }), 'CONTRACT_NOT_CURRENT_REST'],
    ['unresolved signing policy', accountInput({ contractId: 'SPOT_API_KEY_PERMISSIONS' }), 'SIGNING_POLICY_UNRESOLVED'],
    ['duplicate parameter', accountInput({ parameters: [['symbol', 'BTC'], ['Symbol', 'ETH']] }), 'DUPLICATE_PARAMETER'],
    ['reserved parameter', accountInput({ parameters: [['Signature', 'caller']] }), 'RESERVED_PARAMETER'],
    ['missing required order parameter', orderInput({ parameters: [['symbol', 'BTCUSDT']] }), 'REQUIRED_PARAMETER_MISSING'],
    ['missing client identity', orderInput({ clientOrderIdentity: null }), 'CLIENT_ORDER_IDENTITY_REQUIRED'],
    ['client identity on read', accountInput({ clientOrderIdentity: { planId: 'plan_x', legId: 'leg_x', attempt: 0 } }), 'CLIENT_ORDER_IDENTITY_FORBIDDEN'],
    ['insufficient clock samples', accountInput({ clockSamples: clockSamples().slice(0, 2) }), 'CLOCK_EVIDENCE_INVALID'],
    ['wrong-product clock evidence', accountInput({ clockSamples: clockSamples('USD_M_PERPETUAL') }), 'CLOCK_DECISION_BLOCKED'],
    ['stale clock', accountInput({ nowMonotonicMs: NOW_MONOTONIC_MS + 30_001 }), 'CLOCK_DECISION_BLOCKED'],
    ['invalid request sequence', accountInput({ requestSequence: -1 }), 'REQUEST_IDENTITY_INVALID'],
  ];

  for (const [name, input, expectedCode] of cases) {
    await t.test(name, () => {
      let calls = 0;
      const result = constructSignedRequest(input, signer({ sign() { calls += 1; return 'a'.repeat(64); } }));
      expectFailure(result, expectedCode);
      assert.equal(calls, 0);
    });
  }
});

test('credential and key aliases are normalized and rejected before unsigned material or signer access', async (t) => {
  const aliases = [
    'secret',
    'apiKey',
    'api_key',
    'privateKey',
    'private-key',
    'publicKey',
    'keyId',
    'key_id',
    'listenKey',
    'listen_key',
    'xMbxApiKey',
    'x-mbx-api-key',
    'strategyKey',
    'credential',
    'authorization',
    'bearer',
    'token',
    'signature',
  ];
  for (const alias of aliases) {
    await t.test(alias, () => {
      const input = accountInput({ parameters: [[alias, 'bounded-safe-value']] });
      const unsigned = constructUnsignedRequest(input);
      expectFailure(unsigned, 'RESERVED_PARAMETER');
      assert.equal('request' in unsigned, false);

      let calls = 0;
      const signed = constructSignedRequest(input, signer({
        sign() { calls += 1; return 'a'.repeat(64); },
      }));
      expectFailure(signed, 'RESERVED_PARAMETER');
      assert.equal('request' in signed, false);
      assert.equal(calls, 0);
    });
  }
});

test('credential-shaped parameter values are rejected before unsigned material or signer access', async (t) => {
  const values = [
    'A'.repeat(64),
    '-----BEGIN PRIVATE KEY-----',
    'private_key marker',
    'api-secret marker',
    'secret:marker',
    'credential marker',
    'authorization bearer marker',
    'bearer token-material',
  ];
  for (const value of values) {
    await t.test(`shape-${values.indexOf(value)}`, () => {
      const input = accountInput({ parameters: [['note', value]] });
      const unsigned = constructUnsignedRequest(input);
      expectFailure(unsigned, 'PARAMETER_INVALID');
      assert.equal('request' in unsigned, false);

      let calls = 0;
      const signed = constructSignedRequest(input, signer({
        sign() { calls += 1; return 'a'.repeat(64); },
      }));
      expectFailure(signed, 'PARAMETER_INVALID');
      assert.equal('request' in signed, false);
      assert.equal(calls, 0);
    });
  }
});

test('order lookup selector is exact-one-of orderId and origClientOrderId', () => {
  const base = accountInput({
    contractId: 'SPOT_ORDER_QUERY',
    parameters: [['symbol', 'BTCUSDT'], ['orderId', '12345']],
  });
  assert.equal(constructSignedRequest(base, signer()).ok, true);

  expectFailure(
    constructSignedRequest(accountInput({
      contractId: 'SPOT_ORDER_QUERY',
      parameters: [['symbol', 'BTCUSDT']],
    }), signer()),
    'PARAMETER_EXCLUSIVITY_INVALID',
  );
  expectFailure(
    constructSignedRequest(accountInput({
      contractId: 'SPOT_ORDER_QUERY',
      parameters: [['symbol', 'BTCUSDT'], ['orderId', '12345'], ['origClientOrderId', 'cx-safe']],
    }), signer()),
    'PARAMETER_EXCLUSIVITY_INVALID',
  );
});

test('reserved fields, malformed percent text, controls, bidi, surrogates, and non-string values fail closed', async (t) => {
  const cases = [
    ['caller timestamp', [['timestamp', '1700000000000']], 'RESERVED_PARAMETER'],
    ['caller recvWindow', [['recvWindow', '5000']], 'RESERVED_PARAMETER'],
    ['caller client ID', [['newClientOrderId', 'cx-caller']], 'RESERVED_PARAMETER'],
    ['caller API key', [['apiKey', 'public-looking-key']], 'RESERVED_PARAMETER'],
    ['normalized API-key alias', [['api_key', 'public-looking-key']], 'RESERVED_PARAMETER'],
    ['percent sequence', [['note', '%20']], 'PARAMETER_INVALID'],
    ['malformed percent sequence', [['note', '%GG']], 'PARAMETER_INVALID'],
    ['control text', [['note', 'safe\nunsafe']], 'PARAMETER_INVALID'],
    ['bidi text', [['note', 'safe\u202Eunsafe']], 'PARAMETER_INVALID'],
    ['unpaired high surrogate', [['note', '\uD800']], 'PARAMETER_INVALID'],
    ['unpaired low surrogate', [['note', '\uDC00']], 'PARAMETER_INVALID'],
    ['numeric decimal', [['quantity', 0.01]], 'PARAMETER_INVALID'],
    ['empty value', [['symbol', '']], 'PARAMETER_INVALID'],
  ];
  for (const [name, parameters, code] of cases) {
    await t.test(name, () => expectFailure(
      constructSignedRequest(accountInput({ parameters }), signer()),
      code,
    ));
  }
});

test('parameter count, value UTF-8 bytes, and canonical payload have exact bounded failures', () => {
  assert.equal(L03_MAXIMUM_PARAMETERS, 64);
  assert.equal(L03_MAXIMUM_PARAMETER_VALUE_BYTES, 512);

  const exactValue = constructSignedRequest(
    accountInput({ parameters: [['memo', 'é'.repeat(256)]] }),
    signer(),
  );
  assert.equal(exactValue.ok, true);
  expectFailure(
    constructSignedRequest(accountInput({ parameters: [['memo', 'é'.repeat(257)]] }), signer()),
    'PARAMETER_INVALID',
  );

  const overCount = Array.from({ length: 65 }, (_, index) => [`p${index}`, 'x']);
  const exactCount = overCount.slice(0, 64);
  assert.equal(constructSignedRequest(accountInput({ parameters: exactCount }), signer()).ok, true);
  expectFailure(
    constructSignedRequest(accountInput({ parameters: overCount }), signer()),
    'PARAMETER_INVALID',
  );

  let calls = 0;
  const large = Array.from({ length: 20 }, (_, index) => [`payload${index}`, 'x'.repeat(512)]);
  expectFailure(
    constructSignedRequest(accountInput({ parameters: large }), signer({
      sign() { calls += 1; return 'a'.repeat(64); },
    })),
    'PAYLOAD_TOO_LARGE',
  );
  assert.equal(calls, 0);
});

test('hostile input, parameter arrays, and signer objects fail without invoking getters or proxy traps', () => {
  expectFailure(
    constructSignedRequest({ ...accountInput(), unexpected: true }, signer()),
    'INPUT_INVALID',
  );
  const missing = accountInput();
  delete missing.contractId;
  expectFailure(constructSignedRequest(missing, signer()), 'INPUT_INVALID');
  expectFailure(constructSignedRequest(Object.create(accountInput()), signer()), 'INPUT_INVALID');

  let inputGetterCalls = 0;
  const accessorInput = accountInput();
  Object.defineProperty(accessorInput, 'contractId', {
    enumerable: true,
    get() {
      inputGetterCalls += 1;
      return 'SPOT_ACCOUNT_BALANCES';
    },
  });
  expectFailure(constructSignedRequest(accessorInput, signer()), 'INPUT_INVALID');
  assert.equal(inputGetterCalls, 0);

  let pairGetterCalls = 0;
  const pair = ['memo', 'safe'];
  Object.defineProperty(pair, '1', {
    enumerable: true,
    get() {
      pairGetterCalls += 1;
      return 'unsafe';
    },
  });
  expectFailure(
    constructSignedRequest(accountInput({ parameters: [pair] }), signer()),
    'PARAMETER_INVALID',
  );
  assert.equal(pairGetterCalls, 0);

  const trapCalls = { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 };
  const proxiedInput = new Proxy(accountInput(), {
    get() { trapCalls.get += 1; throw new Error('proxy get'); },
    getOwnPropertyDescriptor() { trapCalls.getOwnPropertyDescriptor += 1; throw new Error('proxy descriptor'); },
    getPrototypeOf() { trapCalls.getPrototypeOf += 1; throw new Error('proxy prototype'); },
    ownKeys() { trapCalls.ownKeys += 1; throw new Error('proxy keys'); },
  });
  expectFailure(constructSignedRequest(proxiedInput, signer()), 'INPUT_INVALID');
  assert.deepEqual(trapCalls, { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 });

  const sparse = new Array(2);
  sparse[0] = ['memo', 'safe'];
  expectFailure(
    constructSignedRequest(accountInput({ parameters: sparse }), signer()),
    'PARAMETER_INVALID',
  );

  let signerGetterCalls = 0;
  const accessorSigner = signer();
  Object.defineProperty(accessorSigner, 'sign', {
    enumerable: true,
    get() {
      signerGetterCalls += 1;
      return () => 'a'.repeat(64);
    },
  });
  expectFailure(constructSignedRequest(accountInput(), accessorSigner), 'SIGNER_INVALID');
  assert.equal(signerGetterCalls, 0);

  const revoked = Proxy.revocable(signer(), {});
  revoked.revoke();
  expectFailure(constructSignedRequest(accountInput(), revoked.proxy), 'SIGNER_INVALID');

  const signerTrapCalls = { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 };
  const proxiedSigner = new Proxy(signer(), {
    get() { signerTrapCalls.get += 1; throw new Error('signer get'); },
    getOwnPropertyDescriptor() { signerTrapCalls.getOwnPropertyDescriptor += 1; throw new Error('signer descriptor'); },
    getPrototypeOf() { signerTrapCalls.getPrototypeOf += 1; throw new Error('signer prototype'); },
    ownKeys() { signerTrapCalls.ownKeys += 1; throw new Error('signer keys'); },
  });
  expectFailure(constructSignedRequest(accountInput(), proxiedSigner), 'SIGNER_INVALID');
  assert.deepEqual(signerTrapCalls, { get: 0, getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 });
});

test('signer scope, thrown failures, and malformed output are contained without reflection', async (t) => {
  const mismatches = [
    signer({ profile: 'USDM_HMAC_SHA256' }),
    signer({ product: 'USD_M_PERPETUAL' }),
    signer({ environment: 'TESTNET' }),
  ];
  for (const mismatched of mismatches) {
    let calls = 0;
    mismatched.sign = () => { calls += 1; return 'a'.repeat(64); };
    expectFailure(constructSignedRequest(accountInput(), mismatched), 'SIGNER_SCOPE_MISMATCH');
    assert.equal(calls, 0);
  }

  expectFailure(
    constructSignedRequest(accountInput(), signer({ algorithm: 'RSA_SHA256' })),
    'SIGNER_INVALID',
  );

  await t.test('thrown signer detail is discarded', () => {
    const result = constructSignedRequest(accountInput(), signer({
      sign() {
        throw new Error('sentinel-api-key sentinel-secret signed-payload signature=sentinel');
      },
    }));
    expectFailure(result, 'SIGNER_FAILED');
    const serialized = JSON.stringify(result).toLowerCase();
    for (const text of ['sentinel', 'secret', 'signature', 'payload', 'cause', 'stack', 'message']) {
      assert.equal(serialized.includes(text), false, text);
    }
  });

  for (const output of [null, 42, '', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64)]) {
    await t.test(`invalid output ${typeof output}:${String(output).length}`, () => expectFailure(
      constructSignedRequest(accountInput(), signer({ sign: () => output })),
      'SIGNER_OUTPUT_INVALID',
    ));
  }
});

test('public diagnostic projection removes sensitive signed material and keeps only bounded safe metadata', () => {
  const result = constructSignedRequest(accountInput(), signer({ sign: () => VECTOR_SIGNATURE }));
  assert.equal(result.ok, true);
  const projection = projectSafeDiagnostic(result.request);
  assert.equal(projection.status, 'SANITIZED');
  assert.deepEqual(projection.data, {
    clientOrderId: null,
    contractId: 'SPOT_ACCOUNT_BALANCES',
    environment: 'PRODUCTION',
    mutationClass: 'PRIVATE_ACCOUNT_READ',
    product: 'SPOT',
  });
  const serialized = JSON.stringify(projection).toLowerCase();
  for (const text of [
    VECTOR_SIGNATURE,
    'signature=',
    'recvwindow=',
    'timestamp=',
    'sensitive_signed_request_material',
    'query',
    'material',
    'baseurl',
    'https://',
  ]) {
    assert.equal(serialized.includes(text.toLowerCase()), false, text);
  }
  assertDeeplyFrozen(projection);
});

test('public diagnostic projection also removes classified unsigned request material', () => {
  const result = constructUnsignedRequest(accountInput());
  assert.equal(result.ok, true);
  const projection = projectSafeDiagnostic(result.request);
  assert.equal(projection.status, 'SANITIZED');
  const serialized = JSON.stringify(projection).toLowerCase();
  for (const text of [
    'sensitive_unsigned_request_material',
    'recvwindow=',
    'timestamp=',
    'query',
    'material',
  ]) {
    assert.equal(serialized.includes(text), false, text);
  }
  assertDeeplyFrozen(projection);
});
