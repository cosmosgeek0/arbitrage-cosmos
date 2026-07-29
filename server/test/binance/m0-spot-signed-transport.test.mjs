import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createM0SpotSignedTestOrderMapper,
  M0_SPOT_SIGNED_TEST_ORDER_SCHEMA,
} from '../../dist/binance/m0SpotSignedTransport.js';
import {
  deriveCorrelationId,
} from '../../dist/foundation/contracts/identity.js';
import {
  M0_SPOT_TEST_ORDER_AUTHORITY_SCHEMA,
  M0_SPOT_TEST_ORDER_CONSUMPTION_SCHEMA,
  validateM0SpotTestOrderAuthority,
  validateM0SpotTestOrderConsumptionReceipt,
} from '../../dist/foundation/execution/m0SpotTestOrderAuthority.js';
import {
  createSpotExecutionTicket,
} from '../../dist/foundation/execution/spotTicket.js';

const NOW = 1_900_000_000_000;
const EVALUATED_AT = NOW + 1_000;
const SIGNING_AT = NOW + 7_125;
const NOW_MONOTONIC_MS = 7_100;
const AUTHORITY_CONSUMED_AT = SIGNING_AT;
const REQUEST_ID = 'm0_req_0123456789abcdef0123456789abcdef';
const CLOCK_FENCE_ID = 'm0_clock_fence_0000000000000001';
const AUTHORITY_ISSUED_MONOTONIC_MS = 500;
const AUTHORITY_EXPIRES_MONOTONIC_MS = 9_000;

function clockSample(index) {
  const monotonicSendMs = 1_000 + (index * 3_000);
  const monotonicReceiveMs = monotonicSendMs + 100;
  const utcSendEpochMs = NOW + monotonicSendMs;
  return {
    product: 'SPOT',
    environment: 'PRODUCTION',
    utcSendEpochMs,
    utcReceiveEpochMs: NOW + monotonicReceiveMs,
    monotonicSendMs,
    monotonicReceiveMs,
    serverEpochMs: utcSendEpochMs + 75,
  };
}

function ticket(overrides = {}) {
  return createSpotExecutionTicket({
    correlationId: deriveCorrelationId({
      origin: 'm0.spot.test-order',
      key: 'request.0001',
    }),
    planId: 'plan_m0_spot_test_0001',
    accountId: 'binance-primary',
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: '0.1',
    price: '100',
    riskReferencePrice: '100',
    estimatedMaxLossQuote: '10',
    purpose: 'ENTRY',
    attempt: 0,
    createdAtMs: NOW,
    expiresAtMs: NOW + 10_000,
    ...overrides,
  });
}

function intent(value) {
  return {
    kind: 'SIGNED_TEST_ORDER',
    ticketId: value.ticketId,
    termsDigest: value.termsDigest,
    clientOrderId: value.clientOrderId,
    symbol: value.symbol,
    side: value.side,
    type: value.type,
    timeInForce: value.timeInForce,
    quantity: value.quantity,
    price: value.price,
    filterSnapshotRevision: 'spot-filter-revision-0001',
    createsVenueOrder: false,
    liveSendAuthorized: false,
  };
}

function authority(value, overrides = {}) {
  const confirmedAtMs = overrides.confirmedAtMs ?? NOW + 500;
  const expiresAtMs = overrides.expiresAtMs ?? NOW + 9_000;
  const issuedMonotonicMs = overrides.issuedMonotonicMs
    ?? AUTHORITY_ISSUED_MONOTONIC_MS;
  const expiresMonotonicMs = overrides.expiresMonotonicMs
    ?? issuedMonotonicMs + (expiresAtMs - confirmedAtMs);
  return {
    schema: M0_SPOT_TEST_ORDER_AUTHORITY_SCHEMA,
    authorizationId: 'm0_test_auth_0000000000000001',
    verification: 'VERIFIED_BY_CANONICAL_TEST_ORDER_OWNER',
    scope: 'BINANCE_SPOT_TEST_ORDER_ONLY',
    requestId: REQUEST_ID,
    ticketId: value.ticketId,
    termsDigest: value.termsDigest,
    clientOrderId: value.clientOrderId,
    symbol: value.symbol,
    notionalAsset: 'USDT',
    filterSnapshotRevision: 'spot-filter-revision-0001',
    maximumOrderNotionalQuote: '10',
    confirmedAtMs,
    expiresAtMs,
    clockFenceId: CLOCK_FENCE_ID,
    issuedMonotonicMs,
    expiresMonotonicMs,
    singleUse: true,
    ...overrides,
  };
}

function input(value, authorization, overrides = {}) {
  return {
    requestId: REQUEST_ID,
    ticket: value,
    intent: intent(value),
    authority: authorization,
    correlationId: value.correlationId,
    requestSequence: 1,
    ...overrides,
  };
}

function atomicConsumer(used, calls) {
  return {
    async consume(value) {
      calls.push(value);
      const id = value.authority.authorizationId;
      if (used.has(id)) return null;
      used.add(id);
      return {
        schema: M0_SPOT_TEST_ORDER_CONSUMPTION_SCHEMA,
        authorizationId: id,
        scope: 'BINANCE_SPOT_TEST_ORDER_ONLY',
        requestId: value.requestId,
        ticketId: value.ticket.ticketId,
        termsDigest: value.ticket.termsDigest,
        clientOrderId: value.ticket.clientOrderId,
        notionalAsset: value.authority.notionalAsset,
        filterSnapshotRevision:
          value.authority.filterSnapshotRevision,
        consumedAtMs: value.evaluatedAtMs,
        clockFenceId: value.clockFenceId,
        consumedMonotonicMs: value.evaluatedMonotonicMs,
        state: 'CONSUMED_ONCE',
        authorizationReuseAllowed: false,
      };
    },
  };
}

function signer(calls) {
  return {
    algorithm: 'HMAC_SHA256',
    profile: 'SPOT_HMAC_SHA256',
    product: 'SPOT',
    environment: 'PRODUCTION',
    sign(payload) {
      calls.push(payload);
      return 'a'.repeat(64);
    },
  };
}

function clockWithSamples(clockSamples, ...values) {
  const readings = values.length === 0
    ? [NOW_MONOTONIC_MS, NOW_MONOTONIC_MS]
    : values;
  let index = 0;
  return {
    cut() {
      const monotonicMs = readings[Math.min(index, readings.length - 1)];
      index += 1;
      return {
        utcEpochMs: NOW + monotonicMs,
        monotonicMs,
        clockFenceId: CLOCK_FENCE_ID,
        clockSamples,
      };
    },
  };
}

function monotonicClock(...values) {
  return clockWithSamples([0, 1, 2].map(clockSample), ...values);
}

function validConsumption(value, authorization, overrides = {}) {
  return {
    schema: M0_SPOT_TEST_ORDER_CONSUMPTION_SCHEMA,
    authorizationId: authorization.authorizationId,
    scope: 'BINANCE_SPOT_TEST_ORDER_ONLY',
    requestId: REQUEST_ID,
    ticketId: value.ticketId,
    termsDigest: value.termsDigest,
    clientOrderId: value.clientOrderId,
    notionalAsset: authorization.notionalAsset,
    filterSnapshotRevision: authorization.filterSnapshotRevision,
    consumedAtMs: AUTHORITY_CONSUMED_AT,
    clockFenceId: authorization.clockFenceId,
    consumedMonotonicMs: NOW_MONOTONIC_MS,
    state: 'CONSUMED_ONCE',
    authorizationReuseAllowed: false,
    ...overrides,
  };
}

function authorityValidationInput(value, authorization, overrides = {}) {
  return {
    requestId: REQUEST_ID,
    ticket: value,
    authority: authorization,
    evaluatedAtMs: EVALUATED_AT,
    clockFenceId: CLOCK_FENCE_ID,
    evaluatedMonotonicMs: NOW_MONOTONIC_MS,
    ...overrides,
  };
}

function receiptValidationInput(
  value,
  authorization,
  receipt,
  overrides = {},
) {
  return {
    ...authorityValidationInput(value, authorization),
    receipt,
    minimumMonotonicMs: NOW_MONOTONIC_MS,
    ...overrides,
  };
}

function projectionInventory(value) {
  const keys = [];
  const leaves = [];
  const visit = (candidate) => {
    if (candidate === null || typeof candidate !== 'object') {
      leaves.push(candidate);
      return;
    }
    for (const [key, nested] of Object.entries(candidate)) {
      keys.push(key);
      visit(nested);
    }
  };
  visit(value);
  return { keys, leaves };
}

test('one consumed authority maps only the signed Spot test-order tuple', async () => {
  const value = ticket();
  const authorization = authority(value);
  const consumeCalls = [];
  const signerCalls = [];
  const mapper = createM0SpotSignedTestOrderMapper({
    consumeAuthority: atomicConsumer(new Set(), consumeCalls),
    clock: monotonicClock(),
    signer: signer(signerCalls),
  });

  const result = await mapper.map(input(value, authorization));
  assert.equal(result.ok, true);
  assert.equal(result.mapped.schema, M0_SPOT_SIGNED_TEST_ORDER_SCHEMA);
  assert.equal(result.mapped.operation, 'SIGNED_TEST_PROOF');
  assert.equal(result.mapped.contractId, 'SPOT_TEST_ORDER_POST');
  assert.equal(result.mapped.method, 'POST');
  assert.equal(result.mapped.path, '/api/v3/order/test');
  assert.equal(result.mapped.computeCommissionRates, false);
  assert.equal(result.mapped.notionalAsset, 'USDT');
  assert.equal(result.mapped.authorityScope, 'BINANCE_SPOT_TEST_ORDER_ONLY');
  assert.equal(result.mapped.authorityConsumption.state, 'CONSUMED_ONCE');
  assert.equal(
    result.mapped.authorityConsumption.authorizationReuseAllowed,
    false,
  );
  assert.equal(
    result.mapped.signedProof.proofKind,
    'LOCAL_ROUTE_BOUND_SIGNER_COMMITMENT',
  );
  assert.equal(result.mapped.signedProof.contractId, 'SPOT_TEST_ORDER_POST');
  assert.equal(result.mapped.signedProof.method, 'POST');
  assert.equal(result.mapped.signedProof.product, 'SPOT');
  assert.equal(result.mapped.signedProof.environment, 'PRODUCTION');
  assert.equal(result.mapped.signedProof.path, '/api/v3/order/test');
  assert.equal(result.mapped.signedProof.clientOrderId, value.clientOrderId);
  assert.equal(
    result.mapped.signedProof.mutationClass,
    'TEST_ORDER_MUTATION',
  );
  assert.equal(result.mapped.signedProof.safeRetryClass, 'NEVER_AUTOMATIC');
  assert.equal(result.mapped.signedProof.signedAtMs, SIGNING_AT);
  assert.match(
    result.mapped.signedProof.routeBoundCommitmentSha256,
    /^sha256:[0-9a-f]{64}$/u,
  );
  assert.equal(result.mapped.signedProof.signedMaterialReturned, false);
  assert.equal(
    result.mapped.signedProof.executableMaterialReturned,
    false,
  );
  assert.match(
    signerCalls[0],
    /computeCommissionRates=false/u,
  );
  assert.match(
    signerCalls[0],
    new RegExp(`(?:^|&)timestamp=${SIGNING_AT}(?:&|$)`, 'u'),
  );
  assert.match(signerCalls[0], /(?:^|&)type=LIMIT(?:&|$)/u);
  assert.match(signerCalls[0], /(?:^|&)quantity=0\.1(?:&|$)/u);
  assert.match(signerCalls[0], /(?:^|&)price=100(?:&|$)/u);
  assert.equal(value.orderNotionalQuote, '10');
  const signedQuery = `${signerCalls[0]}&signature=${'a'.repeat(64)}`;
  const commitment = (path) => `sha256:${createHash('sha256').update([
      M0_SPOT_SIGNED_TEST_ORDER_SCHEMA,
      'SPOT_TEST_ORDER_POST',
      'POST',
      path,
      signedQuery,
    ].join('\u0000'), 'utf8').digest('hex')}`;
  assert.equal(
    result.mapped.signedProof.routeBoundCommitmentSha256,
    commitment('/api/v3/order/test'),
  );
  assert.notEqual(
    result.mapped.signedProof.routeBoundCommitmentSha256,
    commitment('/api/v3/sor/order/test'),
  );
  assert.equal(
    result.mapped.authorityConsumption.consumedAtMs,
    AUTHORITY_CONSUMED_AT,
  );
  assert.equal(
    result.mapped.authorityConsumption.consumedMonotonicMs,
    NOW_MONOTONIC_MS,
  );
  assert.equal(result.mapped.automaticRetry, false);
  assert.equal(result.mapped.transportCallsAuthorized, 0);
  assert.equal(result.mapped.dispatchAuthorized, false);
  assert.equal(result.mapped.submitAuthority, 'NONE');
  assert.equal(result.mapped.externalActionAuthorization, 'NONE');
  assert.equal(consumeCalls.length, 1);
  assert.equal(signerCalls.length, 1);
  const publicProjection = JSON.stringify(result.mapped);
  const inventory = projectionInventory(result.mapped);
  assert.equal(Object.isFrozen(result.mapped), true);
  assert.equal(Object.isFrozen(result.mapped.signedProof), true);
  assert.equal(Object.hasOwn(result.mapped, 'request'), false);
  for (const forbiddenKey of [
    'request',
    'material',
    'query',
    'signature',
    'payload',
    'body',
    'headers',
    'url',
  ]) {
    assert.equal(inventory.keys.includes(forbiddenKey), false, forbiddenKey);
  }
  assert.equal(inventory.leaves.includes(signerCalls[0]), false);
  assert.equal(inventory.leaves.includes(signedQuery), false);
  assert.doesNotMatch(publicProjection, /"material"|"query"|signature=/iu);
  assert.equal('send' in mapper, false);
  assert.equal('submit' in mapper, false);
  assert.equal('cancel' in mapper, false);
  assert.equal('query' in mapper, false);
  assert.equal('flatten' in mapper, false);
  assert.equal('transfer' in mapper, false);
  assert.equal('withdraw' in mapper, false);
  assert.equal('withdrawal' in mapper, false);
});

test('shared injected consumer permits one signer invocation across concurrent mapper instances', async () => {
  const value = ticket();
  const authorization = authority(value);
  const used = new Set();
  const consumeCalls = [];
  const signerCalls = [];
  const makeMapper = () => createM0SpotSignedTestOrderMapper({
    consumeAuthority: atomicConsumer(used, consumeCalls),
    clock: monotonicClock(),
    signer: signer(signerCalls),
  });

  const [left, right] = await Promise.all([
    makeMapper().map(input(value, authorization)),
    makeMapper().map(input(value, authorization)),
  ]);
  assert.equal([left, right].filter((result) => result.ok).length, 1);
  assert.equal(
    [left, right].filter(
      (result) => !result.ok
        && result.failure.code === 'AUTHORITY_NOT_CONSUMED',
    ).length,
    1,
  );
  assert.equal(signerCalls.length, 1);

  const replay = await makeMapper().map(input(value, authorization));
  assert.deepEqual(replay, {
    ok: false,
    failure: { code: 'AUTHORITY_NOT_CONSUMED' },
  });
  assert.equal(signerCalls.length, 1);
  assert.equal(consumeCalls.length, 3);
});

test('invalid authority, ticket, or intent fails before consume and signer access', async () => {
  const baseTicket = ticket();
  const cases = [
    {
      label: 'single-use false',
      candidate: input(
        baseTicket,
        authority(baseTicket, { singleUse: false }),
      ),
      code: 'AUTHORITY_INVALID',
    },
    {
      label: 'live scope',
      candidate: input(
        baseTicket,
        authority(baseTicket, { scope: 'SUBMIT_LIVE_ORDER' }),
      ),
      code: 'AUTHORITY_INVALID',
    },
    {
      label: 'wrong request',
      candidate: input(baseTicket, authority(baseTicket, {
        requestId: 'm0_req_ffffffffffffffffffffffffffffffff',
      })),
      code: 'AUTHORITY_BINDING_MISMATCH',
    },
    {
      label: 'wrong ticket',
      candidate: input(
        baseTicket,
        authority(baseTicket, { ticketId: 'spt_wrong' }),
      ),
      code: 'AUTHORITY_BINDING_MISMATCH',
    },
    {
      label: 'wrong filter revision',
      candidate: input(baseTicket, authority(baseTicket, {
        filterSnapshotRevision: 'spot-filter-revision-wrong',
      })),
      code: 'INTENT_BINDING_MISMATCH',
    },
    {
      label: 'wrong notional asset',
      candidate: input(
        baseTicket,
        authority(baseTicket, { notionalAsset: 'BTC' }),
      ),
      code: 'AUTHORITY_INVALID',
    },
    {
      label: 'future confirmation',
      candidate: input(baseTicket, authority(baseTicket, {
        confirmedAtMs: NOW + NOW_MONOTONIC_MS + 1,
      })),
      code: 'AUTHORITY_TIME_INVALID',
    },
    {
      label: 'expired authority',
      candidate: input(
        baseTicket,
        authority(baseTicket, {
          expiresAtMs: NOW + NOW_MONOTONIC_MS,
        }),
      ),
      code: 'AUTHORITY_TIME_INVALID',
    },
    {
      label: 'over ten USDT',
      candidate: (() => {
        const overCeiling = ticket({
          quantity: '0.100000000000000001',
        });
        return input(overCeiling, authority(overCeiling));
      })(),
      code: 'ORDER_NOTIONAL_CEILING_EXCEEDED',
    },
    {
      label: 'non-USDT ticket',
      candidate: (() => {
        const nonUsd = ticket({ symbol: 'ETHBTC' });
        return input(nonUsd, authority(nonUsd));
      })(),
      code: 'TICKET_SCOPE_INVALID',
    },
    {
      label: 'MARKET cannot prove the signed notional ceiling',
      candidate: (() => {
        const market = ticket({
          type: 'MARKET',
          timeInForce: null,
          quantity: '1',
          price: null,
          riskReferencePrice: '10',
        });
        return input(market, authority(market));
      })(),
      code: 'TICKET_SCOPE_INVALID',
    },
    {
      label: 'MARKET SELL cannot prove the signed notional ceiling',
      candidate: (() => {
        const market = ticket({
          side: 'SELL',
          type: 'MARKET',
          timeInForce: null,
          quantity: '1',
          price: null,
          riskReferencePrice: '1',
        });
        return input(market, authority(market));
      })(),
      code: 'TICKET_SCOPE_INVALID',
    },
    {
      label: 'unknown monotonic epoch',
      candidate: input(baseTicket, authority(baseTicket, {
        clockFenceId: 'm0_clock_fence_0000000000000099',
      })),
      code: 'AUTHORITY_CLOCK_FENCE_INVALID',
    },
    {
      label: 'live intent',
      candidate: input(baseTicket, authority(baseTicket), {
        intent: { ...intent(baseTicket), liveSendAuthorized: true },
      }),
      code: 'INTENT_BINDING_MISMATCH',
    },
    {
      label: 'submit intent',
      candidate: input(baseTicket, authority(baseTicket), {
        intent: { ...intent(baseTicket), kind: 'SUBMIT_LIVE_ORDER' },
      }),
      code: 'INTENT_BINDING_MISMATCH',
    },
    {
      label: 'extra input route',
      candidate: {
        ...input(baseTicket, authority(baseTicket)),
        path: '/api/v3/order',
      },
      code: 'INPUT_INVALID',
    },
    {
      label: 'caller-supplied clock evidence',
      candidate: {
        ...input(baseTicket, authority(baseTicket)),
        clockSamples: [0, 1, 2].map(clockSample),
      },
      code: 'INPUT_INVALID',
    },
    {
      label: 'caller-supplied UTC evaluation',
      candidate: {
        ...input(baseTicket, authority(baseTicket)),
        evaluatedAtMs: EVALUATED_AT,
      },
      code: 'INPUT_INVALID',
    },
  ];

  for (const { label, candidate, code } of cases) {
    const consumeCalls = [];
    const signerCalls = [];
    const mapper = createM0SpotSignedTestOrderMapper({
      consumeAuthority: atomicConsumer(new Set(), consumeCalls),
      clock: monotonicClock(),
      signer: signer(signerCalls),
    });
    const result = await mapper.map(candidate);
    assert.deepEqual(result, {
      ok: false,
      failure: { code },
    }, label);
    assert.equal(consumeCalls.length, 0, label);
    assert.equal(signerCalls.length, 0, label);
  }
});

test('hostile mapper inputs are rejected with exact codes without evaluation', async () => {
  const value = ticket();
  const authorization = authority(value);
  let getterReads = 0;
  const hostileInput = new Proxy({}, {
    get() {
      getterReads += 1;
      throw new Error('mapper input must remain unread');
    },
    getOwnPropertyDescriptor() {
      getterReads += 1;
      throw new Error('mapper descriptors must remain unread');
    },
    getPrototypeOf() {
      getterReads += 1;
      throw new Error('mapper prototype must remain unread');
    },
    ownKeys() {
      getterReads += 1;
      throw new Error('mapper keys must remain unread');
    },
  });
  const hostileTicket = {};
  Object.defineProperty(hostileTicket, 'schema', {
    enumerable: true,
    get() {
      getterReads += 1;
      return value.schema;
    },
  });
  const hostileIntent = {};
  Object.defineProperty(hostileIntent, 'kind', {
    enumerable: true,
    get() {
      getterReads += 1;
      return 'SIGNED_TEST_ORDER';
    },
  });

  for (const [candidate, code] of [
    [hostileInput, 'INPUT_INVALID'],
    [
      input(value, authorization, { ticket: hostileTicket }),
      'TICKET_INVALID',
    ],
    [
      input(value, authorization, { intent: hostileIntent }),
      'INTENT_INVALID',
    ],
  ]) {
    const consumeCalls = [];
    const signerCalls = [];
    const result = await createM0SpotSignedTestOrderMapper({
      consumeAuthority: atomicConsumer(new Set(), consumeCalls),
      clock: monotonicClock(),
      signer: signer(signerCalls),
    }).map(candidate);
    assert.deepEqual(result, { ok: false, failure: { code } });
    assert.equal(consumeCalls.length, 0);
    assert.equal(signerCalls.length, 0);
  }
  assert.equal(getterReads, 0);
});

test('authority and receipt validators reject hostile wrappers without evaluating traps', () => {
  const value = ticket();
  const authorization = authority(value);
  const consumption = validConsumption(value, authorization);
  let trapReads = 0;
  const hostileProxy = new Proxy({}, {
    get() {
      trapReads += 1;
      throw new Error('proxy read forbidden');
    },
    getOwnPropertyDescriptor() {
      trapReads += 1;
      throw new Error('descriptor read forbidden');
    },
    getPrototypeOf() {
      trapReads += 1;
      throw new Error('prototype read forbidden');
    },
    ownKeys() {
      trapReads += 1;
      throw new Error('own keys read forbidden');
    },
  });
  const hostileAccessor = {};
  Object.defineProperty(hostileAccessor, 'requestId', {
    enumerable: true,
    get() {
      trapReads += 1;
      throw new Error('accessor read forbidden');
    },
  });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const revokedProxy = revoked.proxy;

  for (const [candidate, code] of [
    [hostileProxy, 'VALIDATION_INPUT_INVALID'],
    [hostileAccessor, 'VALIDATION_INPUT_INVALID'],
    [revokedProxy, 'VALIDATION_INPUT_INVALID'],
    [
      authorityValidationInput(value, hostileProxy),
      'AUTHORITY_INVALID',
    ],
    [
      authorityValidationInput(value, hostileAccessor),
      'AUTHORITY_INVALID',
    ],
    [
      authorityValidationInput(value, revokedProxy),
      'AUTHORITY_INVALID',
    ],
    [
      authorityValidationInput(value, authorization, { extra: true }),
      'VALIDATION_INPUT_INVALID',
    ],
  ]) {
    assert.deepEqual(validateM0SpotTestOrderAuthority(candidate), {
      ok: false,
      code,
    });
  }

  for (const [candidate, code] of [
    [hostileProxy, 'VALIDATION_INPUT_INVALID'],
    [hostileAccessor, 'VALIDATION_INPUT_INVALID'],
    [revokedProxy, 'VALIDATION_INPUT_INVALID'],
    [
      receiptValidationInput(value, authorization, hostileProxy),
      'CONSUMPTION_RECEIPT_INVALID',
    ],
    [
      receiptValidationInput(value, authorization, hostileAccessor),
      'CONSUMPTION_RECEIPT_INVALID',
    ],
    [
      receiptValidationInput(value, authorization, revokedProxy),
      'CONSUMPTION_RECEIPT_INVALID',
    ],
    [
      receiptValidationInput(value, authorization, consumption, {
        extra: true,
      }),
      'VALIDATION_INPUT_INVALID',
    ],
  ]) {
    assert.deepEqual(validateM0SpotTestOrderConsumptionReceipt(candidate), {
      ok: false,
      code,
    });
  }
  assert.equal(trapReads, 0);
});

test('authority and consumption clocks enforce exact lifetime, fence, and monotonic bounds', () => {
  const value = ticket();
  const authorization = authority(value);
  for (const [label, candidate, code] of [
    [
      'UTC and monotonic lifetimes differ',
      authority(value, { expiresMonotonicMs: 9_001 }),
      'AUTHORITY_TIME_INVALID',
    ],
    [
      'authority monotonic issuance is still in the future',
      authority(value, {
        issuedMonotonicMs: NOW_MONOTONIC_MS + 1,
        expiresMonotonicMs: NOW_MONOTONIC_MS + 8_501,
      }),
      'AUTHORITY_TIME_INVALID',
    ],
    [
      'malformed authority fence',
      authority(value, { clockFenceId: 'UNKNOWN' }),
      'AUTHORITY_INVALID',
    ],
    [
      'different authority fence',
      authority(value, {
        clockFenceId: 'm0_clock_fence_0000000000000099',
      }),
      'AUTHORITY_CLOCK_FENCE_INVALID',
    ],
  ]) {
    assert.deepEqual(validateM0SpotTestOrderAuthority(
      authorityValidationInput(value, candidate),
    ), {
      ok: false,
      code,
    }, label);
  }

  const receiptCases = [
    [
      'receipt fence mismatch',
      validConsumption(value, authorization, {
        clockFenceId: 'm0_clock_fence_0000000000000099',
      }),
      {},
      'CONSUMPTION_RECEIPT_BINDING_MISMATCH',
    ],
    [
      'receipt predates the pre-consumption cut',
      validConsumption(value, authorization, {
        consumedMonotonicMs: NOW_MONOTONIC_MS - 1,
      }),
      {},
      'CONSUMPTION_RECEIPT_TIME_INVALID',
    ],
    [
      'receipt postdates the post-consumption cut',
      validConsumption(value, authorization, {
        consumedMonotonicMs: NOW_MONOTONIC_MS + 1,
      }),
      {},
      'CONSUMPTION_RECEIPT_TIME_INVALID',
    ],
    [
      'authority rejects at monotonic expiry equality',
      validConsumption(value, authorization, {
        consumedAtMs: NOW + 8_999,
        consumedMonotonicMs: AUTHORITY_EXPIRES_MONOTONIC_MS,
      }),
      {
        evaluatedAtMs: NOW + 8_999,
        evaluatedMonotonicMs: AUTHORITY_EXPIRES_MONOTONIC_MS,
      },
      'AUTHORITY_TIME_INVALID',
    ],
  ];
  for (const [label, receipt, overrides, code] of receiptCases) {
    assert.deepEqual(validateM0SpotTestOrderConsumptionReceipt(
      receiptValidationInput(value, authorization, receipt, {
        evaluatedAtMs: SIGNING_AT,
        ...overrides,
      }),
    ), {
      ok: false,
      code,
    }, label);
  }
});

test('authority consumer failure and rejection stop before signer access', async () => {
  const value = ticket();
  const authorization = authority(value);
  for (const [consume, code] of [
    [async () => { throw new Error('owner unavailable'); }, 'AUTHORITY_CONSUMER_FAILED'],
    [async () => null, 'AUTHORITY_NOT_CONSUMED'],
  ]) {
    const signerCalls = [];
    const result = await createM0SpotSignedTestOrderMapper({
      consumeAuthority: { consume },
      clock: monotonicClock(),
      signer: signer(signerCalls),
    }).map(input(value, authorization));
    assert.deepEqual(result, { ok: false, failure: { code } });
    assert.equal(signerCalls.length, 0);
  }
});

test('derived signing time independently enforces authority expiry and ticket-bound expiry', async () => {
  const cases = [
    {
      label: 'authority expired while ticket remains live',
      value: ticket({ expiresAtMs: NOW + 10_000 }),
      authorityExpiresAtMs: NOW + 4_000,
    },
    {
      label: 'authority outlives its still-live ticket',
      value: ticket({ expiresAtMs: NOW + 8_000 }),
      authorityExpiresAtMs: NOW + 9_000,
    },
  ];
  for (const row of cases) {
    const authorization = authority(row.value, {
      expiresAtMs: row.authorityExpiresAtMs,
    });
    const consumeCalls = [];
    const signerCalls = [];
    const result = await createM0SpotSignedTestOrderMapper({
      consumeAuthority: atomicConsumer(new Set(), consumeCalls),
      clock: monotonicClock(),
      signer: signer(signerCalls),
    }).map(input(row.value, authorization));
    assert.deepEqual(result, {
      ok: false,
      failure: { code: 'AUTHORITY_TIME_INVALID' },
    }, row.label);
    assert.equal(consumeCalls.length, 0, row.label);
    assert.equal(signerCalls.length, 0, row.label);
  }
});

test('clock-cut sample mutation during consumption fails closed before signer access', async () => {
  const value = ticket();
  const authorization = authority(value);
  const candidate = input(value, authorization);
  const clockSamples = [0, 1, 2].map(clockSample);
  const signerCalls = [];
  let consumeCalls = 0;
  const result = await createM0SpotSignedTestOrderMapper({
    consumeAuthority: {
      async consume(consumeInput) {
        consumeCalls += 1;
        for (const sample of clockSamples) {
          sample.serverEpochMs += 10;
        }
        return validConsumption(value, authorization, {
          consumedAtMs: consumeInput.evaluatedAtMs,
        });
      },
    },
    clock: clockWithSamples(clockSamples),
    signer: signer(signerCalls),
  }).map(candidate);
  assert.deepEqual(result, {
    ok: false,
    failure: { code: 'SIGNED_REQUEST_DRIFT' },
  });
  assert.equal(consumeCalls, 1);
  assert.equal(signerCalls.length, 0);
});

test('clock-fence change after atomic consumption burns authority and never signs', async () => {
  const value = ticket();
  const authorization = authority(value);
  const used = new Set();
  const consumeCalls = [];
  const signerCalls = [];
  let cutIndex = 0;
  const changedFenceClock = {
    cut() {
      const first = cutIndex === 0;
      cutIndex += 1;
      return {
        utcEpochMs: NOW + NOW_MONOTONIC_MS,
        monotonicMs: NOW_MONOTONIC_MS,
        clockFenceId: first
          ? CLOCK_FENCE_ID
          : 'm0_clock_fence_0000000000000099',
        clockSamples: [0, 1, 2].map(clockSample),
      };
    },
  };
  const result = await createM0SpotSignedTestOrderMapper({
    consumeAuthority: atomicConsumer(used, consumeCalls),
    clock: changedFenceClock,
    signer: signer(signerCalls),
  }).map(input(value, authorization));
  assert.deepEqual(result, {
    ok: false,
    failure: { code: 'SIGNED_REQUEST_DRIFT' },
  });
  assert.equal(consumeCalls.length, 1);
  assert.equal(signerCalls.length, 0);

  const replay = await createM0SpotSignedTestOrderMapper({
    consumeAuthority: atomicConsumer(used, consumeCalls),
    clock: monotonicClock(),
    signer: signer(signerCalls),
  }).map(input(value, authorization));
  assert.deepEqual(replay, {
    ok: false,
    failure: { code: 'AUTHORITY_NOT_CONSUMED' },
  });
  assert.equal(consumeCalls.length, 2);
  assert.equal(signerCalls.length, 0);
});

test('post-consumption monotonic time crossing authority expiry stops before signer access', async () => {
  const value = ticket({ expiresAtMs: NOW + 20_000 });
  const authorization = authority(value, { expiresAtMs: NOW + 9_000 });
  const used = new Set();
  const consumeCalls = [];
  const signerCalls = [];
  const result = await createM0SpotSignedTestOrderMapper({
    consumeAuthority: atomicConsumer(used, consumeCalls),
    clock: monotonicClock(NOW_MONOTONIC_MS, 10_000),
    signer: signer(signerCalls),
  }).map(input(value, authorization));
  assert.deepEqual(result, {
    ok: false,
    failure: { code: 'AUTHORITY_TIME_INVALID' },
  });
  assert.equal(consumeCalls.length, 1);
  assert.equal(signerCalls.length, 0);

  const replay = await createM0SpotSignedTestOrderMapper({
    consumeAuthority: atomicConsumer(used, consumeCalls),
    clock: monotonicClock(),
    signer: signer(signerCalls),
  }).map(input(value, authorization));
  assert.deepEqual(replay, {
    ok: false,
    failure: { code: 'AUTHORITY_NOT_CONSUMED' },
  });
  assert.equal(consumeCalls.length, 2);
  assert.equal(signerCalls.length, 0);
});

test('a pre-invocation UTC rollback cannot revive an elapsed authority', async () => {
  const value = ticket({ expiresAtMs: NOW + 30_000 });
  const authorization = authority(value, { expiresAtMs: NOW + 9_000 });
  const consumeCalls = [];
  const signerCalls = [];
  const ordinarySamples = [0, 1, 2].map(clockSample);
  const rolledBackSamples = ordinarySamples.map((sample) => ({
    ...sample,
    utcSendEpochMs: sample.utcSendEpochMs - 2_900,
    utcReceiveEpochMs: sample.utcReceiveEpochMs - 2_900,
    serverEpochMs: sample.serverEpochMs - 2_900,
  }));
  const clock = (utcEpochMs, monotonicMs, clockSamples) => ({
    cut() {
      return {
        utcEpochMs,
        monotonicMs,
        clockFenceId: CLOCK_FENCE_ID,
        clockSamples,
      };
    },
  });
  const makeMapper = (trustedClock) => createM0SpotSignedTestOrderMapper({
    consumeAuthority: atomicConsumer(new Set(), consumeCalls),
    clock: trustedClock,
    signer: signer(signerCalls),
  });

  const elapsed = await makeMapper(
    clock(NOW + 10_025, 10_000, ordinarySamples),
  ).map(input(value, authorization));
  assert.deepEqual(elapsed, {
    ok: false,
    failure: { code: 'AUTHORITY_TIME_INVALID' },
  });

  const rolledBack = await makeMapper(
    clock(NOW + 7_125, 11_000, rolledBackSamples),
  ).map(input(value, authorization));
  assert.deepEqual(rolledBack, {
    ok: false,
    failure: { code: 'AUTHORITY_TIME_INVALID' },
  });
  assert.equal(consumeCalls.length, 0);
  assert.equal(signerCalls.length, 0);
});

test('authority rejects at the monotonic deadline and across clock epochs', async () => {
  const value = ticket();
  const authorization = authority(value);
  for (const [label, trustedClock, code] of [
    [
      'deadline equality',
      {
        cut() {
          return {
            utcEpochMs: NOW + 8_999,
            monotonicMs: AUTHORITY_EXPIRES_MONOTONIC_MS,
            clockFenceId: CLOCK_FENCE_ID,
            clockSamples: [0, 1, 2].map(clockSample),
          };
        },
      },
      'AUTHORITY_TIME_INVALID',
    ],
    [
      'restarted epoch',
      {
        cut() {
          return {
            utcEpochMs: NOW + NOW_MONOTONIC_MS,
            monotonicMs: NOW_MONOTONIC_MS,
            clockFenceId: 'm0_clock_fence_0000000000000099',
            clockSamples: [0, 1, 2].map(clockSample),
          };
        },
      },
      'AUTHORITY_CLOCK_FENCE_INVALID',
    ],
  ]) {
    const consumeCalls = [];
    const signerCalls = [];
    const result = await createM0SpotSignedTestOrderMapper({
      consumeAuthority: atomicConsumer(new Set(), consumeCalls),
      clock: trustedClock,
      signer: signer(signerCalls),
    }).map(input(value, authorization));
    assert.deepEqual(result, {
      ok: false,
      failure: { code },
    }, label);
    assert.equal(consumeCalls.length, 0, label);
    assert.equal(signerCalls.length, 0, label);
  }
});

test('shifted signing epochs cannot extend authority past trusted clock-cut expiry', async () => {
  const value = ticket({ expiresAtMs: NOW + 20_000 });
  const authorization = authority(value, { expiresAtMs: NOW + 9_000 });
  const consumeCalls = [];
  const signerCalls = [];
  const shiftedEpochSamples = [0, 1, 2].map((index) => {
    const sample = clockSample(index);
    return {
      ...sample,
      utcSendEpochMs: sample.utcSendEpochMs - 2_000,
      utcReceiveEpochMs: sample.utcReceiveEpochMs - 2_000,
      serverEpochMs: sample.serverEpochMs - 2_025,
    };
  });
  const result = await createM0SpotSignedTestOrderMapper({
    consumeAuthority: atomicConsumer(new Set(), consumeCalls),
    clock: clockWithSamples(
      shiftedEpochSamples,
      NOW_MONOTONIC_MS,
      9_500,
    ),
    signer: signer(signerCalls),
  }).map(input(value, authorization));
  assert.deepEqual(result, {
    ok: false,
    failure: { code: 'AUTHORITY_TIME_INVALID' },
  });
  assert.equal(consumeCalls.length, 1);
  assert.equal(signerCalls.length, 0);
});

test('forward server time cannot sign past authority expiry while local UTC remains live', async () => {
  const value = ticket({ expiresAtMs: NOW + 30_000 });
  const authorization = authority(value, { expiresAtMs: NOW + 9_000 });
  const ordinarySamples = [0, 1, 2].map(clockSample);
  const forwardServerSamples = ordinarySamples.map((sample) => ({
    ...sample,
    serverEpochMs: sample.serverEpochMs + 10_000,
  }));
  let cutIndex = 0;
  const consumeCalls = [];
  const signerCalls = [];
  const result = await createM0SpotSignedTestOrderMapper({
    consumeAuthority: atomicConsumer(new Set(), consumeCalls),
    clock: {
      cut() {
        const clockSamples = cutIndex === 0
          ? ordinarySamples
          : forwardServerSamples;
        cutIndex += 1;
        return {
          utcEpochMs: NOW + NOW_MONOTONIC_MS,
          monotonicMs: NOW_MONOTONIC_MS,
          clockFenceId: CLOCK_FENCE_ID,
          clockSamples,
        };
      },
    },
    signer: signer(signerCalls),
  }).map(input(value, authorization));
  assert.deepEqual(result, {
    ok: false,
    failure: { code: 'AUTHORITY_TIME_INVALID' },
  });
  assert.equal(consumeCalls.length, 1);
  assert.equal(signerCalls.length, 0);
});

test('monotonic elapsed time cannot be erased by rebasing UTC and server samples', async () => {
  const value = ticket({ expiresAtMs: NOW + 30_000 });
  const authorization = authority(value, { expiresAtMs: NOW + 9_000 });
  const ordinarySamples = [0, 1, 2].map(clockSample);
  const rebasedSamples = ordinarySamples.map((sample) => ({
    ...sample,
    utcSendEpochMs: sample.utcSendEpochMs - 2_400,
    utcReceiveEpochMs: sample.utcReceiveEpochMs - 2_400,
    serverEpochMs: sample.serverEpochMs - 2_400,
  }));
  let cutIndex = 0;
  const consumeCalls = [];
  const signerCalls = [];
  const result = await createM0SpotSignedTestOrderMapper({
    consumeAuthority: atomicConsumer(new Set(), consumeCalls),
    clock: {
      cut() {
        const first = cutIndex === 0;
        cutIndex += 1;
        return {
          utcEpochMs: NOW + NOW_MONOTONIC_MS,
          monotonicMs: first ? NOW_MONOTONIC_MS : 9_500,
          clockFenceId: CLOCK_FENCE_ID,
          clockSamples: first ? ordinarySamples : rebasedSamples,
        };
      },
    },
    signer: signer(signerCalls),
  }).map(input(value, authorization));
  assert.deepEqual(result, {
    ok: false,
    failure: { code: 'AUTHORITY_TIME_INVALID' },
  });
  assert.equal(consumeCalls.length, 1);
  assert.equal(signerCalls.length, 0);
});

test('invalid consumption time spends authority but cannot reach the signer', async () => {
  const value = ticket();
  const authorization = authority(value);
  const signerCalls = [];
  const result = await createM0SpotSignedTestOrderMapper({
    consumeAuthority: {
      async consume() {
        return validConsumption(value, authorization, {
          consumedAtMs: AUTHORITY_CONSUMED_AT + 1,
        });
      },
    },
    clock: monotonicClock(),
    signer: signer(signerCalls),
  }).map(input(value, authorization));
  assert.deepEqual(result, {
    ok: false,
    failure: { code: 'CONSUMPTION_RECEIPT_TIME_INVALID' },
  });
  assert.equal(signerCalls.length, 0);
});

test('a malformed consumption receipt spends authority but cannot reach the signer', async () => {
  const value = ticket();
  const authorization = authority(value);
  let consumeCalls = 0;
  let signerCalls = 0;
  const mapper = createM0SpotSignedTestOrderMapper({
    consumeAuthority: {
      async consume() {
        consumeCalls += 1;
        return validConsumption(value, authorization, {
          authorizationReuseAllowed: true,
        });
      },
    },
    clock: monotonicClock(),
    signer: signer({ push() { signerCalls += 1; } }),
  });
  const result = await mapper.map(input(value, authorization));
  assert.deepEqual(result, {
    ok: false,
    failure: { code: 'CONSUMPTION_RECEIPT_INVALID' },
  });
  assert.equal(consumeCalls, 1);
  assert.equal(signerCalls, 0);
});

test('consumption receipt must retain the filter revision authority binding', async () => {
  const value = ticket();
  const authorization = authority(value);
  const signerCalls = [];
  const mapper = createM0SpotSignedTestOrderMapper({
    consumeAuthority: {
      async consume() {
        return validConsumption(value, authorization, {
          filterSnapshotRevision: 'spot-filter-revision-wrong',
        });
      },
    },
    clock: monotonicClock(),
    signer: signer(signerCalls),
  });
  assert.deepEqual(await mapper.map(input(value, authorization)), {
    ok: false,
    failure: { code: 'CONSUMPTION_RECEIPT_BINDING_MISMATCH' },
  });
  assert.equal(signerCalls.length, 0);
});
