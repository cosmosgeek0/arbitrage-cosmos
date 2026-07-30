import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
  BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA,
  calculateBinanceSpotDispatchRequestDigest,
} from '../../../dist/foundation/execution/m0SpotDispatch.js';
import {
  createBinanceSpotExecutionAdapter,
} from '../../../dist/liveEdge/adapters/binanceSpotExecution/adapter.js';
import {
  calculateM0SpotIntentDigest,
} from '../../../dist/foundation/execution/m0SpotLifecycleCard.js';

const CLIENT_ID = 'cx-0123456789abcdef01234567-0';

function submitIntent(overrides = {}) {
  return Object.freeze({
    kind: 'SUBMIT_LIVE_ORDER',
    ticketId: 'ticket-spot-0001',
    termsDigest: 'a'.repeat(64),
    clientOrderId: CLIENT_ID,
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: '0.001',
    price: '50000',
    ownerAuthorizationId: 'owner-auth-0001',
    signedTestEvidenceId: 'signed-test-0001',
    filterSnapshotRevision: 'filters-0001',
    singleUse: true,
    automaticRetry: false,
    ...overrides,
  });
}

function signedTestIntent(overrides = {}) {
  const live = submitIntent();
  return Object.freeze({
    kind: 'SIGNED_TEST_ORDER',
    ticketId: live.ticketId,
    termsDigest: live.termsDigest,
    clientOrderId: live.clientOrderId,
    symbol: live.symbol,
    side: live.side,
    type: live.type,
    timeInForce: live.timeInForce,
    quantity: live.quantity,
    price: live.price,
    filterSnapshotRevision: live.filterSnapshotRevision,
    createsVenueOrder: false,
    liveSendAuthorized: false,
    ...overrides,
  });
}

function queryIntent(overrides = {}) {
  return Object.freeze({
    kind: 'QUERY_BY_ORIGINAL_CLIENT_ORDER_ID',
    ticketId: 'ticket-spot-0001',
    symbol: 'BTCUSDT',
    originalClientOrderId: CLIENT_ID,
    readOnly: true,
    ...overrides,
  });
}

function flattenIntent(overrides = {}) {
  const { kind: _kind, ...entryTicket } = submitIntent();
  return Object.freeze({
    kind: 'FLATTEN',
    sourceTicketId: 'ticket-spot-0001',
    flattenTicket: Object.freeze({
      ...entryTicket,
      ticketId: 'ticket-flatten-0001',
      clientOrderId: 'cx-0123456789abcdef01234567-1',
      side: 'SELL',
      purpose: 'FLATTEN',
    }),
    residualQuantity: '0.001',
    automaticRetry: false,
    ...overrides,
  });
}

function dispatchIdentity(intent) {
  if (intent.kind === 'FLATTEN') {
    return {
      ticketId: intent.flattenTicket.ticketId,
      termsDigest: intent.flattenTicket.termsDigest,
      clientOrderId: intent.flattenTicket.clientOrderId,
    };
  }
  if (
    intent.kind === 'SIGNED_TEST_ORDER'
    || intent.kind === 'SUBMIT_LIVE_ORDER'
  ) {
    return {
      ticketId: intent.ticketId,
      termsDigest: intent.termsDigest,
      clientOrderId: intent.clientOrderId,
    };
  }
  return {
    ticketId: intent.ticketId,
    termsDigest: 'read-only-query',
    clientOrderId: intent.originalClientOrderId,
  };
}

function consumedAction(action) {
  return action === 'ACTIVE_ORDER_CANCEL' ? 'ENTRY_CANCEL' : action;
}

function validPermit(input) {
  const identity = dispatchIdentity(input.intent);
  const action = consumedAction(input.action);
  const lifecycleId = 'm0_lifecycle_0123456789abcdef0123456789abcdef';
  const cardId = 'm0_card_0123456789abcdef0123456789abcdef';
  const cardDigest = `sha256:${'b'.repeat(64)}`;
  const authorizationId = 'm0_action_0123456789abcdef0123456789abcdef';
  const intentDigest = calculateM0SpotIntentDigest(input.intent);
  const receipt = Object.freeze({
    schema: 'cosmos.foundation.m0-spot-action-consumption.v1',
    version: 1,
    lifecycleId,
    authorizationId,
    cardId,
    cardDigest,
    action,
    ticketId: identity.ticketId,
    termsDigest: identity.termsDigest,
    clientOrderId: identity.clientOrderId,
    intentDigest,
    stateRevision: 7,
    nextStateRevision: 8,
    clockFenceId: 'm0_clock_fence_0123456789abcdef0123456789abcdef',
    consumedAtMs: 1_700_000_000_001,
    consumedMonotonicMs: 1_000_001,
    state: 'CONSUMED_ONCE',
    authorizationReuseAllowed: false,
  });
  return Object.freeze({
    schema: BINANCE_SPOT_DISPATCH_PERMIT_SCHEMA,
    version: 1,
    operation: input.operation,
    credentialProfile: input.request.credentialProfile,
    action,
    lifecycleId,
    cardDigest,
    ticketId: identity.ticketId,
    termsDigest: identity.termsDigest,
    clientOrderId: identity.clientOrderId,
    requestDigest: calculateBinanceSpotDispatchRequestDigest(input.request),
    receipt,
    dispatchCardinality: 'ONE',
    automaticRetry: false,
    externalActionAuthorization: 'DURABLE_ONE_USE_ACTION_CONSUMED',
  });
}

function harness(outcomes, authorityOptions = {}) {
  const requests = [];
  const claims = [];
  const consumed = new Set();
  const adapter = createBinanceSpotExecutionAdapter({
    transport: {
      async send(request, permit) {
        requests.push({ ...request, permit });
        const next = outcomes.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
    authority: {
      async claimDispatch(input) {
        claims.push(input);
        if (authorityOptions.denyDispatch?.(input) === true) return null;
        const identity = dispatchIdentity(input.intent);
        const claimKey = [
          input.operation,
          consumedAction(input.action),
          identity.ticketId,
          identity.clientOrderId,
        ].join('|');
        if (consumed.has(claimKey)) return null;
        consumed.add(claimKey);
        const permit = validPermit(input);
        return authorityOptions.mutatePermit?.(permit, input) ?? permit;
      },
    },
  });
  return { adapter, claims, requests };
}

function parameters(request) {
  return Object.fromEntries(request.parameters);
}

test('schema is explicit and signed test uses the exact no-order route once', async () => {
  assert.equal(
    BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
    'cosmos.live-edge.binance-spot-execution-adapter.v1',
  );
  const { adapter, requests } = harness([
    { kind: 'RESPONSE', status: 200, body: {} },
  ]);

  assert.deepEqual(await adapter.signedTestOrder(signedTestIntent()), {
    kind: 'ACKNOWLEDGED',
    venueOrderId: null,
    cumulativeFilledQuantity: '0',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].schema, BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA);
  assert.equal(requests[0].operation, 'SIGNED_TEST');
  assert.equal(requests[0].credentialProfile, 'SPOT_TRADE_EXECUTION');
  assert.equal(requests[0].contractId, 'SPOT_TEST_ORDER_POST');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].path, '/api/v3/order/test');
  assert.equal(requests[0].automaticRetry, false);
  assert.equal(requests[0].transportCallsAuthorized, 1);
  assert.equal(
    requests[0].externalActionAuthorization,
    'DURABLE_DISPATCH_PERMIT_REQUIRED',
  );
  assert.deepEqual(parameters(requests[0]), {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: '0.001',
    newOrderRespType: 'RESULT',
    price: '50000',
    newClientOrderId: CLIENT_ID,
  });
});

test('live submit maps the exact route and parameters and is never retried', async () => {
  const { adapter, requests } = harness([
    {
      kind: 'RESPONSE',
      status: 200,
      body: {
        symbol: 'BTCUSDT',
        clientOrderId: CLIENT_ID,
        status: 'NEW',
        orderId: 42,
        executedQty: '0',
      },
    },
  ]);
  assert.deepEqual(await adapter.submitLiveOrder(submitIntent()), {
    kind: 'ACKNOWLEDGED',
    venueOrderId: '42',
    cumulativeFilledQuantity: '0',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].schema, BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA);
  assert.equal(requests[0].operation, 'SUBMIT');
  assert.equal(requests[0].credentialProfile, 'SPOT_TRADE_EXECUTION');
  assert.equal(requests[0].contractId, 'SPOT_ORDER_POST');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].path, '/api/v3/order');
  assert.equal(requests[0].automaticRetry, false);
  assert.deepEqual(parameters(requests[0]), {
    symbol: 'BTCUSDT',
    side: 'BUY',
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: '0.001',
    newOrderRespType: 'RESULT',
    price: '50000',
    newClientOrderId: CLIENT_ID,
  });
});

test('every ambiguous mutation outcome returns query guidance without a second POST', async () => {
  const cases = [
    { kind: 'TIMEOUT', dispatched: true },
    { kind: 'DISCONNECTED', dispatched: true },
    { kind: 'RESPONSE', status: 500, body: { code: -1000, msg: 'unknown' } },
    { kind: 'RESPONSE', status: 400, body: { code: -1006, msg: 'unexpected response' } },
    { kind: 'RESPONSE', status: 400, body: { code: -1007, msg: 'timeout' } },
  ];
  for (const outcome of cases) {
    const { adapter, requests } = harness([outcome]);
    const result = await adapter.submitLiveOrder(submitIntent());
    assert.equal(result.kind, 'AMBIGUOUS');
    assert.equal(typeof result.reasonCode, 'string');
    assert.equal(result.queryOriginalClientOrderId, CLIENT_ID);
    assert.equal(result.automaticRetry, false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
  }
});

test('durable ENTRY authority denial blocks before transport dispatch', async () => {
  const { adapter, requests } = harness(
    [{ kind: 'RESPONSE', status: 200, body: {} }],
    { denyDispatch: ({ action }) => action === 'ENTRY' },
  );
  assert.deepEqual(await adapter.submitLiveOrder(submitIntent()), {
    kind: 'REJECTED',
    venueCode: null,
    reasonCode: 'DURABLE_ACTION_AUTHORITY_NOT_CONSUMED',
  });
  assert.equal(requests.length, 0);
});

test('query -2013 is authoritative absence and malformed responses fail closed', async () => {
  const missing = harness([
    { kind: 'RESPONSE', status: 400, body: { code: -2013, msg: 'Order does not exist.' } },
  ]);
  assert.deepEqual(await missing.adapter.queryByOriginalClientOrderId(queryIntent()), {
    kind: 'AUTHORITATIVE_NOT_FOUND',
    originalClientOrderId: CLIENT_ID,
  });
  assert.equal(missing.requests.length, 1);
  assert.equal(missing.requests[0].method, 'GET');
  assert.equal(missing.requests[0].path, '/api/v3/order');

  for (const body of [null, [], {}, { orderId: 42, status: 'ALIEN', executedQty: '0' }]) {
    const hostile = harness([{ kind: 'RESPONSE', status: 200, body }]);
    const result = await hostile.adapter.queryByOriginalClientOrderId(queryIntent());
    assert.equal(result.kind, 'UNRESOLVED');
    assert.equal(hostile.requests.length, 1);
  }
});

test('query -2013 is authoritative only on a qualifying 4xx response', async () => {
  for (const status of [200, 500]) {
    const { adapter, requests } = harness([
      {
        kind: 'RESPONSE',
        status,
        body: { code: -2013, msg: 'Order does not exist.' },
      },
    ]);
    const result = await adapter.queryByOriginalClientOrderId(queryIntent());
    assert.equal(result.kind, 'UNRESOLVED');
    assert.equal(requests.length, 1);
  }
});

test('query accepts Binance EXPIRED_IN_MATCH as a terminal venue observation', async () => {
  const { adapter, requests } = harness([
    {
      kind: 'RESPONSE',
      status: 200,
      body: {
        symbol: 'BTCUSDT',
        clientOrderId: CLIENT_ID,
        status: 'EXPIRED_IN_MATCH',
        orderId: 42,
        executedQty: '0.001',
      },
    },
  ]);

  assert.deepEqual(
    await adapter.queryByOriginalClientOrderId(queryIntent()),
    {
      kind: 'FOUND',
      status: 'EXPIRED_IN_MATCH',
      venueOrderId: '42',
      cumulativeFilledQuantity: '0.001',
    },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].operation, 'QUERY_ORDER');
  assert.equal(requests[0].credentialProfile, 'USER_DATA_READ');
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].path, '/api/v3/order');
  assert.deepEqual(parameters(requests[0]), {
    symbol: 'BTCUSDT',
    origClientOrderId: CLIENT_ID,
  });
});

test('fill query requires exact venue order identity before and after dispatch', async () => {
  const base = Object.freeze({
    kind: 'QUERY_FILLS',
    ticketId: 'ticket-spot-0001',
    symbol: 'BTCUSDT',
    originalClientOrderId: CLIENT_ID,
    venueOrderId: '42',
    readOnly: true,
  });
  const absent = harness([]);
  await assert.rejects(
    absent.adapter.queryFills({ ...base, venueOrderId: null }),
    /^TypeError: exact venue order ID is required for fill query$/,
  );
  assert.equal(absent.requests.length, 0);

  const mismatch = harness([
    {
      kind: 'RESPONSE',
      status: 200,
      body: [{
        symbol: 'BTCUSDT',
        orderId: 43,
        id: 7,
        price: '50000',
        qty: '0.001',
        quoteQty: '50',
        commission: '0.000001',
        commissionAsset: 'BTC',
        time: 1_700_000_000_000,
      }],
    },
  ]);
  await assert.rejects(
    mismatch.adapter.queryFills(base),
    /^TypeError: fill query row is malformed$/,
  );
  assert.equal(mismatch.requests.length, 1);
  assert.equal(mismatch.requests[0].operation, 'QUERY_FILLS');
  assert.equal(mismatch.requests[0].credentialProfile, 'USER_DATA_READ');
});

test('fill query preserves Binance quoteQty and rejects a non-exact quote product', async () => {
  const intent = Object.freeze({
    kind: 'QUERY_FILLS',
    ticketId: 'ticket-spot-0001',
    symbol: 'BTCUSDT',
    originalClientOrderId: CLIENT_ID,
    venueOrderId: '42',
    readOnly: true,
  });
  const row = Object.freeze({
    symbol: 'BTCUSDT',
    orderId: 42,
    id: 7,
    price: '50000',
    qty: '0.001',
    quoteQty: '50',
    commission: '0.000001',
    commissionAsset: 'BTC',
    time: 1_700_000_000_000,
  });
  const exact = harness([{
    kind: 'RESPONSE',
    status: 200,
    body: [row],
  }]);

  assert.deepEqual(await exact.adapter.queryFills(intent), [{
    fillId: '7',
    venueOrderId: '42',
    price: '50000',
    quantity: '0.001',
    quoteQuantity: '50',
    commission: '0.000001',
    commissionAsset: 'BTC',
    occurredAtMs: 1_700_000_000_000,
  }]);
  assert.equal(exact.requests.length, 1);

  const inexact = harness([{
    kind: 'RESPONSE',
    status: 200,
    body: [{ ...row, quoteQty: '49.99999999' }],
  }]);
  await assert.rejects(
    inexact.adapter.queryFills(intent),
    /^TypeError: fill quote quantity does not equal exact price times quantity$/,
  );
  assert.equal(inexact.requests.length, 1);
});

test('cancel is one DELETE only and transport failure is ambiguous without retry', async () => {
  const { adapter, requests } = harness([
    { kind: 'TIMEOUT', dispatched: true },
  ]);
  const result = await adapter.cancel(Object.freeze({
    kind: 'CANCEL_BY_ORIGINAL_CLIENT_ORDER_ID',
    ticketId: 'ticket-spot-0001',
    symbol: 'BTCUSDT',
    originalClientOrderId: CLIENT_ID,
    automaticRetry: false,
  }));
  assert.equal(result.kind, 'AMBIGUOUS');
  assert.equal(result.queryOriginalClientOrderId, CLIENT_ID);
  assert.equal(result.automaticRetry, false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].credentialProfile, 'SPOT_TRADE_EXECUTION');
  assert.equal(requests[0].contractId, 'SPOT_ORDER_CANCEL');
  assert.equal(requests[0].method, 'DELETE');
  assert.equal(requests[0].path, '/api/v3/order');
});

test('durable cancel authority denial blocks before DELETE dispatch', async () => {
  const { adapter, requests } = harness(
    [{ kind: 'RESPONSE', status: 200, body: {} }],
    { denyDispatch: ({ action }) => action === 'ACTIVE_ORDER_CANCEL' },
  );
  assert.deepEqual(await adapter.cancel(Object.freeze({
    kind: 'CANCEL_BY_ORIGINAL_CLIENT_ORDER_ID',
    ticketId: 'ticket-spot-0001',
    symbol: 'BTCUSDT',
    originalClientOrderId: CLIENT_ID,
    automaticRetry: false,
  })), {
    kind: 'REJECTED',
    venueCode: null,
    reasonCode: 'DURABLE_ACTION_AUTHORITY_NOT_CONSUMED',
  });
  assert.equal(requests.length, 0);
});

test('malformed cancellation success remains ambiguous and is never retried', async () => {
  const { adapter, requests } = harness([
    {
      kind: 'RESPONSE',
      status: 200,
      body: {
        symbol: 'BTCUSDT',
        origClientOrderId: CLIENT_ID,
        status: 'NEW',
        orderId: 42,
        executedQty: '0',
      },
    },
  ]);
  const result = await adapter.cancel(Object.freeze({
    kind: 'CANCEL_BY_ORIGINAL_CLIENT_ORDER_ID',
    ticketId: 'ticket-spot-0001',
    symbol: 'BTCUSDT',
    originalClientOrderId: CLIENT_ID,
    automaticRetry: false,
  }));
  assert.deepEqual(result, {
    kind: 'AMBIGUOUS',
    reasonCode: 'CANCEL_SUCCESS_NOT_TERMINAL',
    queryOriginalClientOrderId: CLIENT_ID,
    automaticRetry: false,
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'DELETE');
});

test('flatten requires durable one-use authority and maps one POST without ambiguity retry', async () => {
  const denied = harness(
    [{ kind: 'RESPONSE', status: 200, body: {} }],
    { denyDispatch: ({ action }) => action === 'FLATTEN' },
  );
  assert.deepEqual(await denied.adapter.flatten(flattenIntent()), {
    kind: 'REJECTED',
    venueCode: null,
    reasonCode: 'DURABLE_ACTION_AUTHORITY_NOT_CONSUMED',
  });
  assert.equal(denied.requests.length, 0);

  const allowed = harness([{ kind: 'TIMEOUT', dispatched: true }]);
  const result = await allowed.adapter.flatten(flattenIntent());
  assert.equal(result.kind, 'AMBIGUOUS');
  assert.equal(
    result.queryOriginalClientOrderId,
    flattenIntent().flattenTicket.clientOrderId,
  );
  assert.equal(result.automaticRetry, false);
  assert.equal(allowed.requests.length, 1);
  assert.equal(allowed.requests[0].operation, 'FLATTEN');
  assert.equal(
    allowed.requests[0].credentialProfile,
    'SPOT_TRADE_EXECUTION',
  );
  assert.equal(allowed.requests[0].contractId, 'SPOT_ORDER_POST');
  assert.equal(allowed.requests[0].method, 'POST');
  assert.equal(allowed.requests[0].path, '/api/v3/order');
  assert.equal(allowed.requests[0].automaticRetry, false);
});

test('exact request and intent digests are bound into the durable permit', async () => {
  const { adapter, claims, requests } = harness([
    {
      kind: 'RESPONSE',
      status: 200,
      body: {
        symbol: 'BTCUSDT',
        clientOrderId: CLIENT_ID,
        status: 'NEW',
        orderId: 42,
        executedQty: '0',
      },
    },
  ]);
  const intent = submitIntent();
  assert.equal((await adapter.submitLiveOrder(intent)).kind, 'ACKNOWLEDGED');
  assert.equal(claims.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].permit.requestDigest,
    calculateBinanceSpotDispatchRequestDigest(claims[0].request),
  );
  assert.equal(
    requests[0].permit.receipt.intentDigest,
    calculateM0SpotIntentDigest(intent),
  );
  assert.equal(requests[0].permit.receipt.state, 'CONSUMED_ONCE');
  assert.equal(requests[0].permit.receipt.authorizationReuseAllowed, false);
  assert.equal(
    requests[0].externalActionAuthorization,
    'DURABLE_DISPATCH_PERMIT_REQUIRED',
  );
});

test('one-use authority denies replay of the same mutation before transport', async () => {
  const { adapter, claims, requests } = harness([
    {
      kind: 'RESPONSE',
      status: 200,
      body: {
        symbol: 'BTCUSDT',
        clientOrderId: CLIENT_ID,
        status: 'NEW',
        orderId: 42,
        executedQty: '0',
      },
    },
  ]);
  const intent = submitIntent();
  assert.equal((await adapter.submitLiveOrder(intent)).kind, 'ACKNOWLEDGED');
  assert.deepEqual(await adapter.submitLiveOrder(intent), {
    kind: 'REJECTED',
    venueCode: null,
    reasonCode: 'DURABLE_ACTION_AUTHORITY_NOT_CONSUMED',
  });
  assert.equal(claims.length, 2);
  assert.equal(requests.length, 1);
});

test('permit binding mismatches fail closed before signed transport', async () => {
  const mutations = [
    (permit) => ({ ...permit, requestDigest: `sha256:${'0'.repeat(64)}` }),
    (permit) => ({
      ...permit,
      receipt: {
        ...permit.receipt,
        intentDigest: `sha256:${'1'.repeat(64)}`,
      },
    }),
    (permit) => ({
      ...permit,
      receipt: { ...permit.receipt, schema: 'wrong.schema' },
    }),
    (permit) => ({ ...permit, ticketId: 'ticket-wrong' }),
    (permit) => ({ ...permit, action: 'FLATTEN' }),
    (permit) => ({ ...permit, credentialProfile: 'USER_DATA_READ' }),
    (permit) => ({
      ...permit,
      receipt: { ...permit.receipt, authorizationReuseAllowed: true },
    }),
  ];
  for (const mutatePermit of mutations) {
    const { adapter, requests } = harness(
      [{ kind: 'RESPONSE', status: 200, body: {} }],
      { mutatePermit },
    );
    assert.deepEqual(await adapter.submitLiveOrder(submitIntent()), {
      kind: 'REJECTED',
      venueCode: null,
      reasonCode: 'DURABLE_ACTION_AUTHORITY_NOT_CONSUMED',
    });
    assert.equal(requests.length, 0);
  }
});

test('adapter is direct-import only and contains no ambient authority or forbidden capabilities', async () => {
  const [source, dispatchSource, transportSource, barrel] = await Promise.all([
    readFile(new URL('../../../src/liveEdge/adapters/binanceSpotExecution/adapter.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/foundation/execution/m0SpotDispatch.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/liveEdge/adapters/binanceSpotExecution/productionTransport.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/liveEdge/adapters/index.ts', import.meta.url), 'utf8').catch(() => ''),
  ]);
  assert.doesNotMatch(source, /\bprocess\.env\b|\bfetch\s*\(|https?\.request|\bwithdraw(?:al)?\b|\btransfer\b|\bloan\b/i);
  assert.match(source, /foundation\/execution\/m0SpotDispatch\.js/);
  assert.doesNotMatch(source, /productionTransport/);
  assert.match(dispatchSource, /interface BinanceSpotDispatchAuthorityPort/);
  assert.match(dispatchSource, /interface BinanceSpotSignedTransportPort/);
  assert.doesNotMatch(dispatchSource, /\bfetch\s*\(|\bprocess\.env\b|productionTransport/);
  assert.doesNotMatch(transportSource, /binanceSpotExecution\/adapter/);
  assert.doesNotMatch(barrel, /binanceSpotExecution|createBinanceSpotExecutionAdapter/);
});
