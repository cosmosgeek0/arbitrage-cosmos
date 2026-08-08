import { appendFileSync } from 'node:fs';

const attemptFile = process.env.MARKET_SOURCE_ATTEMPT_FILE;
if (!attemptFile) throw new TypeError('MARKET_SOURCE_ATTEMPT_FILE is required');

const originalFetch = globalThis.fetch.bind(globalThis);
const attempts = new Map();

const bookRow = Object.freeze({
  symbol: 'BTCUSDT',
  bidPrice: '100',
  bidQty: '2',
  askPrice: '101',
  askQty: '3',
  time: 1_700_000_000_000,
});
const futures24hRow = Object.freeze({
  symbol: 'BTCUSDT',
  lastPrice: '100.5',
  priceChangePercent: '1.25',
  highPrice: '102',
  lowPrice: '98',
  volume: '1000',
  quoteVolume: '100500',
  count: 42,
});

function response(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function delayedResponse(body) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(response(body)), 500);
  });
}

globalThis.fetch = (input, init) => {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw);
  if (url.hostname !== 'api.binance.com' && url.hostname !== 'fapi.binance.com') {
    return originalFetch(input, init);
  }

  const key = `${url.hostname}${url.pathname}`;
  const count = (attempts.get(key) ?? 0) + 1;
  attempts.set(key, count);
  appendFileSync(attemptFile, `${key}\n`, 'utf8');

  if (count > 1) {
    // Intentionally ignore AbortSignal. This hostile transport proves that a
    // read path releases after its bounded wait even when acquisition cannot settle.
    return new Promise(() => {});
  }
  if (url.pathname === '/api/v3/ticker/bookTicker') return delayedResponse([bookRow]);
  if (url.pathname === '/fapi/v1/ticker/bookTicker') return delayedResponse([bookRow]);
  if (url.pathname === '/fapi/v1/ticker/24hr') return delayedResponse([futures24hRow]);
  return new Promise(() => {});
};
