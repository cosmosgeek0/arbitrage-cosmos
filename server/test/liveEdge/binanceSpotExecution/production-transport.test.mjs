import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createM0SpotProductionTransport,
  M0_SPOT_PRODUCTION_TRANSPORT_SCHEMA,
} from '../../../dist/liveEdge/adapters/binanceSpotExecution/productionTransport.js';
import {
  BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA,
  BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
  calculateBinanceSpotDispatchPermitDigest,
  calculateBinanceSpotDispatchRequestDigest,
} from '../../../dist/foundation/execution/m0SpotDispatch.js';

const NOW_MS = 1_900_000_000_123;
const MONOTONIC_MS = 1_000;
const CARD_DIGEST = `sha256:${'a'.repeat(64)}`;
const READ_API_KEY = 'm0-read-api-key-0123456789abcdef';
const EXECUTION_API_KEY = 'm0-execution-api-key-0123456789abcdef';
const CLIENT_ORDER_ID = 'm0-spot-entry-0000000000000001';
const LIFECYCLE_ID = 'm0_lifecycle_0000000000000001';
const CARD_ID = 'm0_card_0000000000000001';
const CLOCK_FENCE_ID = 'm0_clock_fence_0000000000000001';

const ENDPOINTS = Object.freeze({
  SIGNED_TEST: Object.freeze({
    contractId: 'SPOT_TEST_ORDER_POST',
    method: 'POST',
    path: '/api/v3/order/test',
    action: 'SIGNED_TEST',
    credentialProfile: 'SPOT_TRADE_EXECUTION',
  }),
  SUBMIT: Object.freeze({
    contractId: 'SPOT_ORDER_POST',
    method: 'POST',
    path: '/api/v3/order',
    action: 'ENTRY',
    credentialProfile: 'SPOT_TRADE_EXECUTION',
  }),
  QUERY_ORDER: Object.freeze({
    contractId: 'SPOT_ORDER_QUERY',
    method: 'GET',
    path: '/api/v3/order',
    action: 'QUERY_ORDER',
    credentialProfile: 'USER_DATA_READ',
  }),
  QUERY_FILLS: Object.freeze({
    contractId: 'SPOT_MY_TRADES_QUERY',
    method: 'GET',
    path: '/api/v3/myTrades',
    action: 'QUERY_FILLS',
    credentialProfile: 'USER_DATA_READ',
  }),
  CANCEL: Object.freeze({
    contractId: 'SPOT_ORDER_CANCEL',
    method: 'DELETE',
    path: '/api/v3/order',
    action: 'ENTRY_CANCEL',
    credentialProfile: 'SPOT_TRADE_EXECUTION',
  }),
  FLATTEN: Object.freeze({
    contractId: 'SPOT_ORDER_POST',
    method: 'POST',
    path: '/api/v3/order',
    action: 'FLATTEN',
    credentialProfile: 'SPOT_TRADE_EXECUTION',
  }),
});

function parameters(operation, overrides = {}) {
  if (operation === 'QUERY_ORDER' || operation === 'CANCEL') {
    return Object.freeze([
      Object.freeze(['symbol', 'BTCUSDT']),
      Object.freeze(['origClientOrderId', CLIENT_ORDER_ID]),
    ]);
  }
  if (operation === 'QUERY_FILLS') {
    return Object.freeze([
      Object.freeze(['symbol', 'BTCUSDT']),
      Object.freeze(['orderId', '42']),
    ]);
  }
  return Object.freeze([
    Object.freeze(['symbol', 'BTCUSDT']),
    Object.freeze(['side', operation === 'FLATTEN' ? 'SELL' : 'BUY']),
    Object.freeze(['type', 'LIMIT']),
    Object.freeze(['quantity', '0.0002']),
    Object.freeze(['newClientOrderId', CLIENT_ORDER_ID]),
    Object.freeze(['newOrderRespType', 'RESULT']),
    Object.freeze(['timeInForce', 'FOK']),
    Object.freeze(['price', '50000']),
  ].map(([name, value]) =>
    Object.freeze([name, overrides[name] ?? value])));
}

function request(operation, overrides = {}) {
  const endpoint = ENDPOINTS[operation];
  return Object.freeze({
    schema: BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
    operation,
    credentialProfile: endpoint.credentialProfile,
    contractId: endpoint.contractId,
    method: endpoint.method,
    path: endpoint.path,
    parameters: overrides.parameters ?? parameters(operation, overrides),
    automaticRetry: false,
    transportCallsAuthorized: 1,
    externalActionAuthorization: 'DURABLE_DISPATCH_PERMIT_REQUIRED',
    ...overrides.request,
  });
}

function permit(value, overrides = {}) {
  const endpoint = ENDPOINTS[value.operation];
  const action = overrides.action ?? endpoint.action;
  const authorizationId =
    overrides.authorizationId ?? `m0_action_${value.operation.toLowerCase()}_0001`;
  const termsDigest = 'b'.repeat(64);
  const ticketId = 'spt_0123456789abcdef0123456789abcdef';
  const intentDigest = `sha256:${'c'.repeat(64)}`;
  const receipt = Object.freeze({
    schema: 'cosmos.foundation.m0-spot-action-consumption.v1',
    version: 1,
    lifecycleId: LIFECYCLE_ID,
    authorizationId,
    cardId: CARD_ID,
    cardDigest: CARD_DIGEST,
    action,
    ticketId,
    termsDigest,
    clientOrderId: CLIENT_ORDER_ID,
    intentDigest,
    stateRevision: 3,
    nextStateRevision: 4,
    clockFenceId: CLOCK_FENCE_ID,
    consumedAtMs: NOW_MS - 2,
    consumedMonotonicMs: 900,
    state: 'CONSUMED_ONCE',
    authorizationReuseAllowed: false,
    ...overrides.receipt,
  });
  const {
    permitDigest: overriddenPermitDigest,
    ...permitOverrides
  } = overrides.permit ?? {};
  const withoutPermitDigest = Object.freeze({
    schema: BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA,
    version: 1,
    operation: value.operation,
    credentialProfile: value.credentialProfile,
    action,
    lifecycleId: LIFECYCLE_ID,
    cardDigest: CARD_DIGEST,
    ticketId,
    termsDigest,
    clientOrderId: CLIENT_ORDER_ID,
    requestDigest: calculateBinanceSpotDispatchRequestDigest(value),
    executionLease: Object.freeze({
      status: 'ACTIVE',
      mode: 'ENTRY',
      requestId: `m0_req_${'1'.repeat(32)}`,
      idempotencyKeyDigest: `sha256:${'2'.repeat(64)}`,
      operatorId: 'owner-account-4',
      executorId: 'm0-account-4-executor',
      hostId: 'runtime-host',
      bootId: 'boot-0000000000000001',
      processId: 'pid-4004',
      revision: '0123456789abcdef0123456789abcdef01234567',
      clockFenceId: CLOCK_FENCE_ID,
      acquiredAtMs: NOW_MS - 10,
      acquiredMonotonicMs: 800,
      ...overrides.executionLease,
    }),
    claimedAtMs: NOW_MS - 1,
    claimedMonotonicMs: 950,
    dispatchDeadlineAtMs: NOW_MS + 999,
    dispatchDeadlineMonotonicMs: 1_950,
    requestTimeoutMs: 5_000,
    recvWindowMs: 5_000,
    acceptanceSettlesAtMs: NOW_MS + 10_999,
    acceptanceSettlesMonotonicMs: 11_950,
    receipt,
    dispatchCardinality: 'ONE',
    automaticRetry: false,
    externalActionAuthorization: 'DURABLE_ONE_USE_ACTION_CONSUMED',
    ...permitOverrides,
  });
  return Object.freeze({
    ...withoutPermitDigest,
    permitDigest:
      overriddenPermitDigest
      ?? calculateBinanceSpotDispatchPermitDigest(withoutPermitDigest),
  });
}

function harness(overrides = {}) {
  const calls = {
    clock: 0,
    sign: [],
    fetch: [],
  };
  const readSigner = overrides.readSigner ?? {
    algorithm: 'HMAC_SHA256',
    apiKey: READ_API_KEY,
    async sign(payload) {
      calls.sign.push({ profile: 'USER_DATA_READ', payload });
      return 'd'.repeat(64);
    },
  };
  const executionSigner = overrides.executionSigner ?? {
    algorithm: 'HMAC_SHA256',
    apiKey: EXECUTION_API_KEY,
    async sign(payload) {
      calls.sign.push({ profile: 'SPOT_TRADE_EXECUTION', payload });
      return 'd'.repeat(64);
    },
  };
  const clockState = overrides.clockState ?? {
    nowMs: NOW_MS,
    monotonicMs: MONOTONIC_MS,
    clockFenceId: CLOCK_FENCE_ID,
  };
  const spentPermits = new Set();
  const egress = overrides.egress ?? Object.freeze({
    async spend(input) {
      if (spentPermits.has(input.permitDigest)) return null;
      spentPermits.add(input.permitDigest);
      return Object.freeze({
        ...input,
        spentAtMs: clockState.nowMs,
        spentMonotonicMs: clockState.monotonicMs,
        state: 'SPENT_ONCE',
      });
    },
    async confirm() {
      return true;
    },
  });
  const transport = createM0SpotProductionTransport({
    allowedSymbol: 'BTCUSDT',
    allowedCardDigest: CARD_DIGEST,
    recvWindowMs: 5_000,
    requestTimeoutMs: 5_000,
    maximumResponseBytes: overrides.maximumResponseBytes ?? 64 * 1024,
    clock: {
      nowMs() {
        calls.clock += 1;
        return clockState.nowMs;
      },
      monotonicMs: () => clockState.monotonicMs,
      clockFenceId: () => clockState.clockFenceId,
    },
    readSigner,
    executionSigner,
    egress,
    fetch: overrides.fetch ?? (async (...args) => {
      calls.fetch.push(args);
      return new Response(JSON.stringify({
        symbol: 'BTCUSDT',
        orderId: 42,
        clientOrderId: CLIENT_ORDER_ID,
        status: 'NEW',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  });
  return { calls, clockState, transport };
}

test('construction is inert and the production schema is explicit', () => {
  const { calls, transport } = harness();
  assert.equal(
    M0_SPOT_PRODUCTION_TRANSPORT_SCHEMA,
    'cosmos.binance.m0-spot-production-transport.v1',
  );
  assert.equal(typeof transport.send, 'function');
  assert.deepEqual(calls, { clock: 0, sign: [], fetch: [] });
});

test('every allowed operation uses only its exact signed Binance Spot endpoint', async () => {
  for (const operation of Object.keys(ENDPOINTS)) {
    const { calls, transport } = harness();
    const value = request(operation);
    const result = await transport.send(value, permit(value));

    assert.equal(result.kind, 'RESPONSE');
    assert.equal(result.status, 200);
    assert.equal(calls.clock, 4);
    assert.equal(calls.sign.length, 1);
    assert.equal(calls.fetch.length, 1);

    const [rawUrl, init] = calls.fetch[0];
    const url = new URL(rawUrl);
    assert.equal(url.origin, 'https://api.binance.com');
    assert.equal(url.pathname, ENDPOINTS[operation].path);
    assert.equal(init.method, ENDPOINTS[operation].method);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Accept, 'application/json');
    assert.equal(
      init.headers['X-MBX-APIKEY'],
      ENDPOINTS[operation].credentialProfile === 'USER_DATA_READ'
        ? READ_API_KEY
        : EXECUTION_API_KEY,
    );
    assert.equal(url.searchParams.get('recvWindow'), '5000');
    assert.equal(url.searchParams.get('timestamp'), String(NOW_MS));
    assert.equal(url.searchParams.get('signature'), 'd'.repeat(64));
    assert.equal(url.searchParams.has('apiKey'), false);
    assert.equal(url.searchParams.has('apiSecret'), false);
    assert.equal(url.searchParams.has('secretKey'), false);
    assert.equal(
      calls.sign[0].payload,
      url.search.slice(1, url.search.lastIndexOf('&signature=')),
    );
    assert.equal(
      calls.sign[0].profile,
      ENDPOINTS[operation].credentialProfile,
    );
    assert.equal(init.body, undefined);
  }
});

test('order routes preserve the fixed symbol, side, LIMIT FOK identity and exact ten-USDT ceiling', async () => {
  for (const operation of ['SIGNED_TEST', 'SUBMIT', 'FLATTEN']) {
    const { calls, transport } = harness();
    const value = request(operation);
    await transport.send(value, permit(value));
    const url = new URL(calls.fetch[0][0]);
    assert.equal(url.searchParams.get('symbol'), 'BTCUSDT');
    assert.equal(
      url.searchParams.get('side'),
      operation === 'FLATTEN' ? 'SELL' : 'BUY',
    );
    assert.equal(url.searchParams.get('type'), 'LIMIT');
    assert.equal(url.searchParams.get('timeInForce'), 'FOK');
    assert.equal(url.searchParams.get('quantity'), '0.0002');
    assert.equal(url.searchParams.get('price'), '50000');
    assert.equal(url.searchParams.get('newClientOrderId'), CLIENT_ORDER_ID);
    assert.equal(url.searchParams.get('newOrderRespType'), 'RESULT');
  }

  for (const invalid of [
    request('SUBMIT', { quantity: '0.00020001' }),
    request('SUBMIT', { symbol: 'ETHUSDT' }),
    request('SUBMIT', { side: 'SELL' }),
    request('SUBMIT', { type: 'MARKET' }),
    request('SUBMIT', { timeInForce: 'GTC' }),
    request('SUBMIT', { timeInForce: 'IOC' }),
  ]) {
    const { calls, transport } = harness();
    await assert.rejects(
      transport.send(invalid, permit(invalid)),
      /ceiling|violate the card/,
    );
    assert.deepEqual(calls, { clock: 0, sign: [], fetch: [] });
  }
});

test('an exact durable permit is mandatory and is consumed at most once', async () => {
  const { calls, transport } = harness();
  const value = request('SUBMIT');
  const authorization = permit(value);
  await transport.send(value, authorization);
  await assert.rejects(
    transport.send(value, authorization),
    /already used/,
  );
  assert.equal(calls.clock, 4);
  assert.equal(calls.sign.length, 1);
  assert.equal(calls.fetch.length, 1);

  for (const invalid of [
    permit(value, {
      permit: { permitDigest: `sha256:${'0'.repeat(64)}` },
    }),
    permit(value, { permit: { requestDigest: `sha256:${'0'.repeat(64)}` } }),
    permit(value, { permit: { cardDigest: `sha256:${'0'.repeat(64)}` } }),
    permit(value, { permit: { credentialProfile: 'USER_DATA_READ' } }),
    permit(value, { action: 'FLATTEN' }),
    permit(value, { permit: { automaticRetry: true } }),
    permit(value, {
      receipt: { authorizationReuseAllowed: true },
    }),
    permit(value, {
      receipt: { state: 'NOT_CONSUMED' },
    }),
    permit(value, {
      receipt: { version: 2 },
    }),
  ]) {
    const isolated = harness();
    await assert.rejects(
      isolated.transport.send(value, invalid),
      /permit is invalid/,
    );
    assert.deepEqual(isolated.calls, { clock: 0, sign: [], fetch: [] });
  }
});

test('durable egress denial or a mismatched spend receipt blocks before fetch', async () => {
  for (const spend of [
    async () => null,
    async (input) => Object.freeze({
      ...input,
      requestDigest: `sha256:${'f'.repeat(64)}`,
      spentAtMs: NOW_MS,
      spentMonotonicMs: MONOTONIC_MS,
      state: 'SPENT_ONCE',
    }),
  ]) {
    const { calls, transport } = harness({
      egress: Object.freeze({
        spend,
        confirm: async () => true,
      }),
    });
    const value = request('SUBMIT');
    await assert.rejects(
      transport.send(value, permit(value)),
      /already spent/,
    );
    assert.equal(calls.sign.length, 1);
    assert.equal(calls.fetch.length, 0);
  }
});

test('a takeover fence blocks a suspended old permit and every late resume before signer or fetch', async () => {
  const clockState = {
    nowMs: NOW_MS,
    monotonicMs: MONOTONIC_MS,
    clockFenceId: CLOCK_FENCE_ID,
  };
  const { calls, transport } = harness({ clockState });
  const value = request('SUBMIT');
  const suspendedPermit = permit(value);

  clockState.clockFenceId =
    'm0_clock_fence_takeover000000000000000000000001';
  await assert.rejects(
    transport.send(value, suspendedPermit),
    /permit is stale/,
  );
  assert.equal(calls.sign.length, 0);
  assert.equal(calls.fetch.length, 0);

  clockState.nowMs = suspendedPermit.acceptanceSettlesAtMs + 1;
  clockState.monotonicMs =
    suspendedPermit.acceptanceSettlesMonotonicMs + 1;
  await assert.rejects(
    transport.send(value, suspendedPermit),
    /permit is stale/,
  );
  assert.equal(calls.sign.length, 0);
  assert.equal(calls.fetch.length, 0);
});

test('a fence or clock change while durable egress spend is awaited blocks before fetch', async () => {
  const clockState = {
    nowMs: NOW_MS,
    monotonicMs: MONOTONIC_MS,
    clockFenceId: CLOCK_FENCE_ID,
  };
  const egress = Object.freeze({
    async spend(input) {
      const receipt = Object.freeze({
        ...input,
        spentAtMs: clockState.nowMs,
        spentMonotonicMs: clockState.monotonicMs,
        state: 'SPENT_ONCE',
      });
      clockState.clockFenceId =
        'm0_clock_fence_takeover-after-spend-0000000001';
      return receipt;
    },
    async confirm() {
      return true;
    },
  });
  const { calls, transport } = harness({ clockState, egress });
  const value = request('SUBMIT');

  await assert.rejects(
    transport.send(value, permit(value)),
    /permit is stale/,
  );
  assert.equal(calls.sign.length, 1);
  assert.equal(calls.fetch.length, 0);
});

test('endpoint substitution, extra parameters, retry flags and credentials in parameters fail before signing', async () => {
  const cases = [
    request('SUBMIT', { request: { path: '/api/v3/openOrders' } }),
    request('SUBMIT', { request: { automaticRetry: true } }),
    request('QUERY_ORDER', {
      request: { credentialProfile: 'SPOT_TRADE_EXECUTION' },
    }),
    request('SUBMIT', {
      parameters: Object.freeze([
        ...parameters('SUBMIT'),
        Object.freeze(['apiKey', EXECUTION_API_KEY]),
      ]),
    }),
    request('QUERY_ORDER', {
      parameters: Object.freeze([
        ...parameters('QUERY_ORDER'),
        Object.freeze(['orderId', '42']),
      ]),
    }),
  ];
  for (const value of cases) {
    const { calls, transport } = harness();
    await assert.rejects(transport.send(value, permit(value)));
    assert.deepEqual(calls, { clock: 0, sign: [], fetch: [] });
  }
});

test('one disconnected or 5xx fetch produces one outcome and is never retried', async () => {
  for (const mode of ['disconnect', 'server']) {
    let fetchCalls = 0;
    const { calls, transport } = harness({
      fetch: async (...args) => {
        calls.fetch.push(args);
        fetchCalls += 1;
        if (mode === 'disconnect') throw new Error('socket closed');
        return new Response(JSON.stringify({ code: -1000, msg: 'unknown' }), {
          status: 500,
        });
      },
    });
    const value = request('SUBMIT');
    const result = await transport.send(value, permit(value));
    assert.equal(fetchCalls, 1);
    assert.equal(calls.sign.length, 1);
    assert.equal(calls.fetch.length, 1);
    assert.equal(
      result.kind,
      mode === 'disconnect' ? 'DISCONNECTED' : 'RESPONSE',
    );
    if (mode === 'server') assert.equal(result.status, 500);
  }
});

test('an oversized chunked response is canceled at the byte bound without retry or credential leakage', async () => {
  const maximumResponseBytes = 64;
  const chunks = [
    Buffer.alloc(32, 'a'),
    Buffer.alloc(32, 'b'),
    Buffer.from('c'),
    Buffer.from('this chunk must never be pulled'),
  ];
  let pulls = 0;
  let pulledBytes = 0;
  let cancelCalls = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      const chunk = chunks[pulls];
      pulls += 1;
      pulledBytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelCalls += 1;
    },
  }, {
    highWaterMark: 0,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(response.headers.has('content-length'), false);

  let fetchCalls = 0;
  const { calls, transport } = harness({
    maximumResponseBytes,
    fetch: async (...args) => {
      calls.fetch.push(args);
      fetchCalls += 1;
      return response;
    },
  });
  const value = request('SUBMIT');
  const result = await transport.send(value, permit(value));

  assert.deepEqual(result, {
    kind: 'DISCONNECTED',
    dispatched: true,
  });
  assert.equal(fetchCalls, 1);
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.sign.length, 1);
  assert.equal(pulls, 3);
  assert.equal(pulledBytes, maximumResponseBytes + 1);
  assert.equal(cancelCalls, 1);

  const [signedUrl] = calls.fetch[0];
  const serializedOutcome = JSON.stringify(result);
  assert.equal(serializedOutcome.includes(signedUrl), false);
  assert.equal(serializedOutcome.includes(READ_API_KEY), false);
  assert.equal(serializedOutcome.includes(EXECUTION_API_KEY), false);
  assert.equal(serializedOutcome.includes('d'.repeat(64)), false);
});

test('configuration requires separate read and execution profiles and bounds timing', async () => {
  const readSigner = {
    algorithm: 'HMAC_SHA256',
    apiKey: READ_API_KEY,
    sign: async () => 'd'.repeat(64),
  };
  const executionSigner = {
    algorithm: 'HMAC_SHA256',
    apiKey: EXECUTION_API_KEY,
    sign: async () => 'd'.repeat(64),
  };
  for (const config of [
    { recvWindowMs: 0, requestTimeoutMs: 5_000 },
    { recvWindowMs: 5_001, requestTimeoutMs: 5_000 },
    { recvWindowMs: 5_000, requestTimeoutMs: 0 },
    { recvWindowMs: 5_000, requestTimeoutMs: 5_001 },
  ]) {
    assert.throws(() => createM0SpotProductionTransport({
      allowedSymbol: 'BTCUSDT',
      allowedCardDigest: CARD_DIGEST,
      ...config,
      clock: {
        nowMs: () => NOW_MS,
        monotonicMs: () => MONOTONIC_MS,
        clockFenceId: () => CLOCK_FENCE_ID,
      },
      readSigner,
      executionSigner,
      fetch: async () => new Response('{}'),
    }), /not configured/);
  }

  for (const profiles of [
    { readSigner: undefined, executionSigner },
    { readSigner, executionSigner: undefined },
    { readSigner, executionSigner: readSigner },
    {
      readSigner,
      executionSigner: { ...executionSigner, apiKey: READ_API_KEY },
    },
  ]) {
    assert.throws(() => createM0SpotProductionTransport({
      allowedSymbol: 'BTCUSDT',
      allowedCardDigest: CARD_DIGEST,
      recvWindowMs: 5_000,
      requestTimeoutMs: 5_000,
      clock: {
        nowMs: () => NOW_MS,
        monotonicMs: () => MONOTONIC_MS,
        clockFenceId: () => CLOCK_FENCE_ID,
      },
      ...profiles,
      fetch: async () => new Response('{}'),
    }), /not configured/);
  }

  const edCalls = [];
  const { transport } = harness({
    readSigner: {
      algorithm: 'ED25519',
      apiKey: READ_API_KEY,
      async sign(payload) {
        edCalls.push(payload);
        return 'A'.repeat(88);
      },
    },
  });
  const value = request('QUERY_ORDER');
  assert.equal((await transport.send(value, permit(value))).kind, 'RESPONSE');
  assert.equal(edCalls.length, 1);
});
