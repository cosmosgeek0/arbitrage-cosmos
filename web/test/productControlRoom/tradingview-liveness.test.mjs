import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  INITIAL_TRADING_VIEW_LIVENESS,
  TRADING_VIEW_FALLBACK_TIMEOUT_MS,
  TRADING_VIEW_LOAD_TIMEOUT_MS,
  reduceTradingViewLiveness,
  tradingViewFallbackRequest,
} from '../../src/components/TradingViewWidget.tsx';

test('TradingView loading terminates in a same-origin fallback or an honest unavailable state', () => {
  assert.ok(TRADING_VIEW_LOAD_TIMEOUT_MS > 0 && TRADING_VIEW_LOAD_TIMEOUT_MS <= 15_000);
  assert.ok(TRADING_VIEW_FALLBACK_TIMEOUT_MS > 0 && TRADING_VIEW_FALLBACK_TIMEOUT_MS <= 15_000);

  const fallback = reduceTradingViewLiveness(INITIAL_TRADING_VIEW_LIVENESS, {
    kind: 'EXTERNAL_TIMEOUT',
  });
  assert.deepEqual(fallback, {
    status: 'FALLBACK_LOADING',
    failure: 'EXTERNAL_TIMEOUT',
  });
  assert.deepEqual(reduceTradingViewLiveness(fallback, { kind: 'FALLBACK_SUCCESS' }), {
    status: 'FALLBACK_READY',
    failure: 'EXTERNAL_TIMEOUT',
  });
  assert.deepEqual(reduceTradingViewLiveness(fallback, { kind: 'FALLBACK_FAILURE' }), {
    status: 'UNAVAILABLE',
    failure: 'FALLBACK_FAILURE',
  });

  const externalReady = reduceTradingViewLiveness(INITIAL_TRADING_VIEW_LIVENESS, {
    kind: 'EXTERNAL_LOAD',
  });
  assert.deepEqual(externalReady, { status: 'EXTERNAL_READY', failure: null });
  assert.deepEqual(
    reduceTradingViewLiveness(externalReady, { kind: 'EXTERNAL_TIMEOUT' }),
    externalReady,
    'a stale timeout cannot replace a completed external load',
  );
});

test('TradingView fallback requests only the same-origin candle owner', () => {
  const spot = tradingViewFallbackRequest('BINANCE:BTCUSDT', '5m');
  const spotUrl = new URL(spot, 'https://control-room.invalid');
  assert.equal(spotUrl.origin, 'https://control-room.invalid');
  assert.equal(spotUrl.pathname, '/api/candles');
  assert.deepEqual(Object.fromEntries(spotUrl.searchParams), {
    symbol: 'BTCUSDT',
    interval: '5m',
    limit: '1000',
    market: 'spot',
  });

  const futures = tradingViewFallbackRequest('BINANCE:ETHUSDT.P', '1h');
  const futuresUrl = new URL(futures, 'https://control-room.invalid');
  assert.equal(futuresUrl.origin, 'https://control-room.invalid');
  assert.equal(futuresUrl.searchParams.get('symbol'), 'ETHUSDT');
  assert.equal(futuresUrl.searchParams.get('market'), 'futures');
});

test('TradingView effect mirrors every external resource with cleanup and renders the local chart on fallback', async () => {
  const source = await readFile(
    new URL('../../src/components/TradingViewWidget.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /https:\/\/s3\.tradingview\.com\/external-embedding\/embed-widget-advanced-chart\.js/);
  assert.match(source, /script\.onload\s*=/);
  assert.match(source, /script\.onerror\s*=/);
  assert.match(source, /window\.setTimeout\([\s\S]*TRADING_VIEW_LOAD_TIMEOUT_MS/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /window\.setTimeout\([\s\S]*TRADING_VIEW_FALLBACK_TIMEOUT_MS/);
  assert.match(source, /fetch\(fallbackUrl,[\s\S]*credentials:\s*'same-origin'[\s\S]*signal:\s*fallbackController\.signal/);
  assert.match(source, /return \(\) => \{[\s\S]*script\.onload = null[\s\S]*script\.onerror = null[\s\S]*fallbackController\.abort\(\)/);
  assert.match(source, /<TradingViewChart[\s\S]*candles=\{fallbackCandles\}/);
  assert.doesNotMatch(source, /<iframe\b/);
});
