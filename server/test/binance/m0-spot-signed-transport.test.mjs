import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveCorrelationId } from '../../dist/foundation/contracts/identity.js';
import { deriveBinanceSpotClientOrderId } from '../../dist/foundation/exchange/binanceSpot/clientOrderId.js';
import {
  M0_SPOT_SIGNED_TRANSPORT_TUPLES,
  mapM0SpotSignedTransportRequest,
} from '../../dist/binance/m0SpotSignedTransport.js';

const UTC_ORIGIN_MS = 1_700_000_000_000;
const NOW_MONOTONIC_MS = 7_100;
const CORRELATION_ID = deriveCorrelationId({
  origin: 'm0.spot.transport.test',
  key: 'request.0001',
});
const IDENTITY = Object.freeze({
  planId: 'plan_m0_spot_0001',
  legId: 'leg_m0_spot_entry_0001',
  attempt: 0,
});
const CLIENT_ORDER_ID = deriveBinanceSpotClientOrderId(IDENTITY);

function clockSamples() {
  return [0, 1, 2].map((index) => {
    const monotonicSendMs = 1_000 + (index * 3_000);
    const monotonicReceiveMs = monotonicSendMs + 100;
    const utcSendEpochMs = UTC_ORIGIN_MS + monotonicSendMs;
    return {
      product: 'SPOT',
      environment: 'PRODUCTION',
      utcSendEpochMs,
      utcReceiveEpochMs: UTC_ORIGIN_MS + monotonicReceiveMs,
      monotonicSendMs,
      monotonicReceiveMs,
      serverEpochMs: utcSendEpochMs + 75,
    };
  });
}

function signer(onCall = () => {}) {
  return {
    algorithm: 'HMAC_SHA256',
    profile: 'SPOT_HMAC_SHA256',
    product: 'SPOT',
    environment: 'PRODUCTION',
    sign(payload) {
      onCall(payload);
      return 'a'.repeat(64);
    },
  };
}

function binding(clientOrderIdentity = null, overrides = {}) {
  return {
    clockSamples: clockSamples(),
    nowMonotonicMs: NOW_MONOTONIC_MS,
    correlationId: CORRELATION_ID,
    requestSequence: 1,
    clientOrderIdentity,
    ...overrides,
  };
}

function request(
  operation,
  contractId,
  method,
  path,
  parameters,
) {
  return {
    schema: 'cosmos.live-edge.binance-spot-execution-adapter.v1',
    operation,
    contractId,
    method,
    path,
    parameters,
    automaticRetry: false,
    transportCallsAuthorized: 1,
    externalActionAuthorization: 'INJECTED_INTENT_ONLY',
  };
}

test('exact Spot adapter tuples map to signed bytes but authorize zero dispatches', () => {
  const payloads = [];
  const mapped = mapM0SpotSignedTransportRequest(
    request(
      'SUBMIT',
      'SPOT_ORDER_POST',
      'POST',
      '/api/v3/order',
      [
        ['symbol', 'BTCUSDT'],
        ['side', 'BUY'],
        ['type', 'MARKET'],
        ['quantity', '0.0002'],
        ['newClientOrderId', CLIENT_ORDER_ID],
        ['newOrderRespType', 'RESULT'],
      ],
    ),
    binding(IDENTITY),
    signer((payload) => payloads.push(payload)),
  );

  assert.equal(mapped.ok, true);
  assert.equal(payloads.length, 1);
  assert.equal(mapped.mapped.operation, 'SUBMIT');
  assert.equal(mapped.mapped.contractId, 'SPOT_ORDER_POST');
  assert.equal(mapped.mapped.method, 'POST');
  assert.equal(mapped.mapped.path, '/api/v3/order');
  assert.equal(mapped.mapped.automaticRetry, false);
  assert.equal(mapped.mapped.transportCallsAuthorized, 0);
  assert.equal(mapped.mapped.dispatchAuthorized, false);
  assert.equal(mapped.mapped.externalActionAuthorization, 'NONE');
  assert.equal(mapped.mapped.request.externalActionAuthorization, 'NONE');
  assert.equal(mapped.mapped.request.actionAuthority, 'NONE_RECORD_ONLY');
  assert.match(
    mapped.mapped.request.material.query,
    new RegExp(`(?:^|&)newClientOrderId=${CLIENT_ORDER_ID}(?:&|$)`, 'u'),
  );
  assert.match(mapped.mapped.request.material.query, /&signature=a{64}$/u);
  assert.equal(
    mapped.mapped.request.material.query.match(/newClientOrderId=/gu)?.length,
    1,
  );
});

test('read, cancel, and signed-test mappings preserve exact contracts with no retry capability', () => {
  const cases = [
    [
      request('QUERY_ORDER', 'SPOT_ORDER_QUERY', 'GET', '/api/v3/order', [
        ['symbol', 'BTCUSDT'],
        ['origClientOrderId', CLIENT_ORDER_ID],
      ]),
      binding(),
    ],
    [
      request('QUERY_FILLS', 'SPOT_MY_TRADES_QUERY', 'GET', '/api/v3/myTrades', [
        ['symbol', 'BTCUSDT'],
        ['orderId', '42'],
      ]),
      binding(),
    ],
    [
      request('CANCEL', 'SPOT_ORDER_CANCEL', 'DELETE', '/api/v3/order', [
        ['symbol', 'BTCUSDT'],
        ['origClientOrderId', CLIENT_ORDER_ID],
      ]),
      binding(),
    ],
    [
      request('SIGNED_TEST', 'SPOT_TEST_ORDER_POST', 'POST', '/api/v3/order/test', [
        ['symbol', 'BTCUSDT'],
        ['side', 'BUY'],
        ['type', 'MARKET'],
        ['quantity', '0.0002'],
        ['newClientOrderId', CLIENT_ORDER_ID],
        ['newOrderRespType', 'RESULT'],
      ]),
      binding(IDENTITY),
    ],
  ];
  for (const [transportRequest, transportBinding] of cases) {
    const mapped = mapM0SpotSignedTransportRequest(
      transportRequest,
      transportBinding,
      signer(),
    );
    assert.equal(mapped.ok, true);
    assert.equal(mapped.mapped.transportCallsAuthorized, 0);
    assert.equal(mapped.mapped.dispatchAuthorized, false);
    assert.equal(mapped.mapped.automaticRetry, false);
  }
});

test('tuple widening and client-order mismatch fail before signer access', () => {
  let signerCalls = 0;
  const forbiddenTuple = mapM0SpotSignedTransportRequest(
    request(
      'SUBMIT',
      'SPOT_ORDER_POST',
      'POST',
      '/api/v3/order/test',
      [],
    ),
    binding(IDENTITY),
    signer(() => { signerCalls += 1; }),
  );
  assert.deepEqual(forbiddenTuple, {
    ok: false,
    failure: { code: 'REQUEST_TUPLE_FORBIDDEN' },
  });

  const mismatched = mapM0SpotSignedTransportRequest(
    request('SUBMIT', 'SPOT_ORDER_POST', 'POST', '/api/v3/order', [
      ['symbol', 'BTCUSDT'],
      ['side', 'BUY'],
      ['type', 'MARKET'],
      ['quantity', '0.0002'],
      ['newClientOrderId', 'cx-0123456789abcdef01234567-0'],
      ['newOrderRespType', 'RESULT'],
    ]),
    binding(IDENTITY),
    signer(() => { signerCalls += 1; }),
  );
  assert.deepEqual(mismatched, {
    ok: false,
    failure: { code: 'CLIENT_ORDER_BINDING_MISMATCH' },
  });
  assert.equal(signerCalls, 0);
});

test('signed transport surface is an exact frozen five-contract mapper', () => {
  assert.deepEqual(M0_SPOT_SIGNED_TRANSPORT_TUPLES, [
    'CANCEL|SPOT_ORDER_CANCEL|DELETE|/api/v3/order',
    'FLATTEN|SPOT_ORDER_POST|POST|/api/v3/order',
    'QUERY_FILLS|SPOT_MY_TRADES_QUERY|GET|/api/v3/myTrades',
    'QUERY_ORDER|SPOT_ORDER_QUERY|GET|/api/v3/order',
    'SIGNED_TEST|SPOT_TEST_ORDER_POST|POST|/api/v3/order/test',
    'SUBMIT|SPOT_ORDER_POST|POST|/api/v3/order',
  ]);
  assert.equal(Object.isFrozen(M0_SPOT_SIGNED_TRANSPORT_TUPLES), true);
});
