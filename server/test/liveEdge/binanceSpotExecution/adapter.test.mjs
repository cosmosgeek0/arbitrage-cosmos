import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BINANCE_SPOT_EXECUTION_ADAPTER_SCHEMA,
  createBinanceSpotExecutionAdapter,
} from '../../../dist/liveEdge/adapters/binanceSpotExecution/adapter.js';

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
  return Object.freeze({
    kind: 'FLATTEN',
    sourceTicketId: 'ticket-spot-0001',
    flattenTicket: Object.freeze({
      ...submitIntent(),
      kind: undefined,
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

function harness(outcomes, verifiers = {}) {
  const requests = [];
  const adapter = createBinanceSpotExecutionAdapter({
    verifyLiveSubmitIntent:
      verifiers.verifyLiveSubmitIntent ?? (() => true),
    verifyFlattenIntent: verifiers.verifyFlattenIntent ?? (() => true),
    verifyCancelIntent: verifiers.verifyCancelIntent ?? (() => true),
    async send(request) {
      requests.push(request);
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { adapter, requests };
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
  assert.equal(requests[0].contractId, 'SPOT_TEST_ORDER_POST');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].path, '/api/v3/order/test');
  assert.equal(requests[0].automaticRetry, false);
  assert.equal(requests[0].transportCallsAuthorized, 1);
  assert.equal(
    requests[0].externalActionAuthorization,
    'INJECTED_INTENT_ONLY',
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

test('independent live-intent denial blocks before transport dispatch', async () => {
  const { adapter, requests } = harness(
    [{ kind: 'RESPONSE', status: 200, body: {} }],
    { verifyLiveSubmitIntent: () => false },
  );
  assert.deepEqual(await adapter.submitLiveOrder(submitIntent()), {
    kind: 'REJECTED',
    venueCode: null,
    reasonCode: 'LIVE_SUBMIT_INTENT_INVALID',
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
  assert.equal(requests[0].contractId, 'SPOT_ORDER_CANCEL');
  assert.equal(requests[0].method, 'DELETE');
  assert.equal(requests[0].path, '/api/v3/order');
});

test('independent cancel-intent denial blocks before DELETE dispatch', async () => {
  const { adapter, requests } = harness(
    [{ kind: 'RESPONSE', status: 200, body: {} }],
    { verifyCancelIntent: () => false },
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
    reasonCode: 'CANCEL_INTENT_INVALID',
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

test('flatten requires independent proof and maps one POST without ambiguity retry', async () => {
  const denied = harness(
    [{ kind: 'RESPONSE', status: 200, body: {} }],
    { verifyFlattenIntent: () => false },
  );
  assert.deepEqual(await denied.adapter.flatten(flattenIntent()), {
    kind: 'REJECTED',
    venueCode: null,
    reasonCode: 'FLATTEN_INTENT_INVALID',
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
  assert.equal(allowed.requests[0].contractId, 'SPOT_ORDER_POST');
  assert.equal(allowed.requests[0].method, 'POST');
  assert.equal(allowed.requests[0].path, '/api/v3/order');
  assert.equal(allowed.requests[0].automaticRetry, false);
});

test('adapter is direct-import only and contains no ambient authority or forbidden capabilities', async () => {
  const [source, barrel] = await Promise.all([
    readFile(new URL('../../../src/liveEdge/adapters/binanceSpotExecution/adapter.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/liveEdge/adapters/index.ts', import.meta.url), 'utf8').catch(() => ''),
  ]);
  assert.doesNotMatch(source, /\bprocess\.env\b|\bfetch\s*\(|https?\.request|\bwithdraw(?:al)?\b|\btransfer\b|\bloan\b/i);
  assert.doesNotMatch(barrel, /binanceSpotExecution|createBinanceSpotExecutionAdapter/);
});
