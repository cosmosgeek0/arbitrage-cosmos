import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { BinanceApiError, BinanceClient, rateLimit } from '../dist/binance/client.js';

const CREDS = {
  apiKey: 'TEST_API_KEY_DO_NOT_USE_123456789',
  apiSecret: 'TEST_SECRET_DO_NOT_USE_987654321',
};
const NOW = 1_700_000_000_000;

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function client(fetchFn, options = {}) {
  return new BinanceClient(CREDS, {
    fetch: fetchFn,
    now: () => NOW,
    requestTimeoutMs: 100,
    maxResponseBytes: 64 * 1024,
    ...options,
  });
}

async function capturedError(task) {
  try {
    await task();
  } catch (error) {
    return error;
  }
  assert.fail('expected request to fail');
}

test('private WebSocket subscription frame uses the current signed protocol and sorted HMAC payload', () => {
  const binance = client(async () => assert.fail('WebSocket signing must not perform a REST request'));
  const serialized = binance.userDataStreamSubscribeFrame('request_001');
  const frame = JSON.parse(serialized);
  const signingPayload = `apiKey=${CREDS.apiKey}&recvWindow=5000&timestamp=${NOW}`;
  const expectedSignature = createHmac('sha256', CREDS.apiSecret)
    .update(signingPayload)
    .digest('hex');

  assert.equal(frame.id, 'request_001');
  assert.equal(frame.method, 'userDataStream.subscribe.signature');
  assert.deepEqual(Object.keys(frame.params), ['apiKey', 'recvWindow', 'timestamp', 'signature']);
  assert.equal(frame.params.apiKey, CREDS.apiKey);
  assert.equal(frame.params.recvWindow, 5000);
  assert.equal(frame.params.timestamp, NOW);
  assert.equal(frame.params.signature, expectedSignature);
  assert.equal(serialized.includes(CREDS.apiSecret), false, 'the API secret never leaves the signing boundary');
  assert.throws(
    () => binance.userDataStreamSubscribeFrame('../unsafe request'),
    /request id is invalid/i,
  );
});

test('signed requests reject redirects, include a fresh valid signature, and capture weight', async () => {
  let seen;
  const binance = client(async (input, init) => {
    seen = { input: String(input), init };
    return jsonResponse({ balances: [], canTrade: true, canWithdraw: false }, 200, {
      'x-mbx-used-weight-1m': '42',
    });
  });

  const account = await binance.account();
  const url = new URL(seen.input);
  const headers = new Headers(seen.init.headers);
  const signature = url.searchParams.get('signature');
  const unsigned = new URLSearchParams(url.searchParams);
  unsigned.delete('signature');
  const expected = createHmac('sha256', CREDS.apiSecret).update(unsigned.toString()).digest('hex');

  assert.deepEqual(account, { balances: [], canTrade: true, canWithdraw: false });
  assert.equal(seen.init.redirect, 'error');
  assert.equal(headers.get('x-mbx-apikey'), CREDS.apiKey);
  assert.equal(url.pathname, '/api/v3/account');
  assert.equal(url.searchParams.get('timestamp'), String(NOW));
  assert.equal(url.searchParams.get('recvWindow'), '5000');
  assert.equal(signature, expected);
  assert.equal(rateLimit.usedWeight1m, 42);
  assert.equal(rateLimit.ts, NOW);
});

test('REST 418/429 Retry-After establishes a local cooldown before another signed request', async () => {
  let now = NOW;
  let calls = 0;
  const binance = client(async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({ code: -1003, msg: 'slow down' }, 429, { 'retry-after': '2' });
    return jsonResponse({ balances: [], canTrade: true, canWithdraw: false });
  }, { now: () => now });

  const first = await capturedError(() => binance.account());
  assert.ok(first instanceof BinanceApiError);
  assert.equal(first.httpStatus, 429);
  const blocked = await capturedError(() => binance.account());
  assert.ok(blocked instanceof BinanceApiError);
  assert.match(blocked.message, /cooldown/i);
  assert.equal(calls, 1, 'cooldown blocks the request before fetch');
  assert.equal(rateLimit.cooldownUntil, NOW + 2_000);

  now += 2_000;
  const recovered = await binance.account();
  assert.equal(recovered.canTrade, true);
  assert.equal(calls, 2);
});

test('non-JSON and malformed JSON responses are rejected', async () => {
  const htmlClient = client(async () => new Response('<html>no</html>', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  }));
  const htmlError = await capturedError(() => htmlClient.account());
  assert.ok(htmlError instanceof BinanceApiError);
  assert.match(htmlError.message, /non-JSON/i);

  const malformedClient = client(async () => new Response('{"balances":', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  const malformedError = await capturedError(() => malformedClient.account());
  assert.ok(malformedError instanceof BinanceApiError);
  assert.match(malformedError.message, /malformed JSON/i);
});

test('decompressed response bytes are bounded while streaming', async () => {
  const binance = client(
    async () => jsonResponse({ value: 'x'.repeat(256) }),
    { maxResponseBytes: 64 },
  );
  const error = await capturedError(() => binance.account());

  assert.ok(error instanceof BinanceApiError);
  assert.match(error.message, /size limit/i);
});

test('request timeout remains active through body consumption', async () => {
  let abortObserved = false;
  const binance = client(async (_input, init) => {
    const signal = init.signal;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"balances":'));
        signal.addEventListener('abort', () => {
          abortObserved = true;
          controller.error(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      },
    });
    return new Response(stream, { headers: { 'content-type': 'application/json' } });
  }, { requestTimeoutMs: 20 });

  const error = await capturedError(() => binance.account());
  assert.match(error.message, /timed out: \/api\/v3\/account/i);
  assert.equal(abortObserved, true);
});

test('transport and Binance error messages never expose credentials or query URLs', async () => {
  const upstream = client(async () => jsonResponse({
    code: -2015,
    msg: `denied ${CREDS.apiKey} ${CREDS.apiSecret} https://api.binance.com/api/v3/account?signature=rawsig&apiKey=${CREDS.apiKey} signature=rawsig`,
  }, 401));
  const upstreamError = await capturedError(() => upstream.account());
  assert.ok(upstreamError instanceof BinanceApiError);
  for (const secret of [CREDS.apiKey, CREDS.apiSecret, 'rawsig']) {
    assert.equal(upstreamError.message.includes(secret), false);
  }
  assert.equal(upstreamError.message.includes('?'), false);

  const transport = client(async (input) => {
    throw new Error(`failed ${String(input)} ${CREDS.apiSecret}`);
  });
  const transportError = await capturedError(() => transport.account());
  assert.equal(transportError.message, 'Binance request failed: /api/v3/account');
  assert.equal(transportError.message.includes(CREDS.apiSecret), false);
  assert.equal(transportError.message.includes('?'), false);
});

test('reserved credential and signature query parameters are rejected before fetch', async () => {
  let calls = 0;
  const binance = client(async () => {
    calls += 1;
    return jsonResponse({});
  });

  const error = await capturedError(() => binance.testOrder({
    symbol: 'BTCUSDT',
    signature: 'caller-controlled',
  }));
  assert.match(error.message, /reserved parameter/i);
  assert.equal(calls, 0);
});

test('malformed permission payloads remain unknown instead of becoming false safety claims', async () => {
  const binance = client(async () => jsonResponse({}));
  const error = await capturedError(() => binance.apiRestrictions());
  assert.ok(error instanceof BinanceApiError);
  assert.match(error.message, /incomplete API restrictions/i);
});

test('-1021 performs one unsigned server-time sync and rebuilds the signed retry', async () => {
  const calls = [];
  let signedAttempts = 0;
  const serverTime = NOW + 7_500;
  const binance = client(async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === '/api/v3/time') return jsonResponse({ serverTime });
    signedAttempts += 1;
    if (signedAttempts === 1) {
      return jsonResponse({ code: -1021, msg: 'Timestamp outside recvWindow' }, 400);
    }
    return jsonResponse({ balances: [], canTrade: true, canWithdraw: false });
  });

  const result = await binance.account();
  const signed = calls.filter(({ url }) => url.pathname === '/api/v3/account');
  const time = calls.filter(({ url }) => url.pathname === '/api/v3/time');

  assert.equal(result.canTrade, true);
  assert.equal(signed.length, 2);
  assert.equal(time.length, 1);
  assert.equal(calls.length, 3);
  assert.equal(signed[0].url.searchParams.get('timestamp'), String(NOW));
  assert.equal(signed[1].url.searchParams.get('timestamp'), String(serverTime));
  assert.notEqual(signed[0].url.searchParams.get('signature'), signed[1].url.searchParams.get('signature'));
  assert.equal(new Headers(time[0].init.headers).has('x-mbx-apikey'), false);
  assert.equal(time[0].url.search, '');
  assert.equal(time[0].init.redirect, 'error');
  const streamFrame = JSON.parse(binance.userDataStreamSubscribeFrame('after_time_sync'));
  assert.equal(streamFrame.params.timestamp, serverTime, 'WebSocket signing shares the corrected clock');
});

test('a second -1021 is returned without another sync or retry', async () => {
  let signedAttempts = 0;
  let timeCalls = 0;
  const binance = client(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v3/time') {
      timeCalls += 1;
      return jsonResponse({ serverTime: NOW + 1_000 });
    }
    signedAttempts += 1;
    return jsonResponse({ code: -1021, msg: 'still outside recvWindow' }, 400);
  });

  const error = await capturedError(() => binance.account());
  assert.ok(error instanceof BinanceApiError);
  assert.equal(error.binanceCode, -1021);
  assert.equal(signedAttempts, 2);
  assert.equal(timeCalls, 1);
});

test('concurrent -1021 responses share one server-time synchronization', async () => {
  let signedAttempts = 0;
  let timeCalls = 0;
  const serverTime = NOW + 2_000;
  const binance = client(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v3/time') {
      timeCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return jsonResponse({ serverTime });
    }
    signedAttempts += 1;
    if (url.searchParams.get('timestamp') === String(NOW)) {
      return jsonResponse({ code: -1021, msg: 'clock skew' }, 400);
    }
    return jsonResponse({ balances: [], canTrade: true, canWithdraw: false });
  });

  const [first, second] = await Promise.all([binance.account(), binance.account()]);
  assert.equal(first.canTrade, true);
  assert.equal(second.canTrade, true);
  assert.equal(signedAttempts, 4);
  assert.equal(timeCalls, 1);
});

test('ongoing flexible loans paginate to the authoritative total', async () => {
  const calls = [];
  const binance = client(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(url.pathname, '/sapi/v2/loan/flexible/ongoing/orders');
    const current = Number(url.searchParams.get('current'));
    if (current === 1) {
      return jsonResponse({
        total: 101,
        rows: Array.from({ length: 100 }, (_, index) => ({ loanCoin: `A${index}`, collateralCoin: 'USDT' })),
      });
    }
    return jsonResponse({ total: 101, rows: [{ loanCoin: 'A100', collateralCoin: 'USDT' }] });
  });

  const result = await binance.ongoingLoans();
  assert.equal(result.total, 101);
  assert.equal(result.rows.length, 101);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((url) => url.searchParams.get('current')), ['1', '2']);
  assert.ok(calls.every((url) => url.searchParams.get('limit') === '100'));
});

test('ongoing flexible loans fail closed when Binance reports state beyond the bounded cap', async () => {
  let calls = 0;
  const binance = client(async () => {
    calls += 1;
    return jsonResponse({ total: 2_001, rows: [] });
  });

  const error = await capturedError(() => binance.ongoingLoans());
  assert.ok(error instanceof BinanceApiError);
  assert.match(error.message, /2,?000-row safety cap/i);
  assert.equal(calls, 1);
});
