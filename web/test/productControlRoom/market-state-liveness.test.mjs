import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  INITIAL_MARKET_STATE_TRUTH,
  reduceMarketStateTruth,
} from '../../src/store.tsx';

test('market reads distinguish loading, first failure, current, and retained stale evidence', () => {
  assert.deepEqual(INITIAL_MARKET_STATE_TRUTH, {
    status: 'LOADING',
    lastSuccessAtMs: null,
    error: null,
  });

  const unavailable = reduceMarketStateTruth(INITIAL_MARKET_STATE_TRUTH, {
    kind: 'FAILURE',
    observedAtMs: 1_000,
    error: 'market refresh failed',
  });
  assert.deepEqual(unavailable, {
    status: 'UNAVAILABLE',
    lastSuccessAtMs: null,
    error: 'market refresh failed',
  });

  const current = reduceMarketStateTruth(unavailable, {
    kind: 'SUCCESS',
    observedAtMs: 2_000,
  });
  assert.deepEqual(current, {
    status: 'CURRENT',
    lastSuccessAtMs: 2_000,
    error: null,
  });

  const stale = reduceMarketStateTruth(current, {
    kind: 'FAILURE',
    observedAtMs: 3_000,
    error: ' timeout ',
  });
  assert.deepEqual(stale, {
    status: 'STALE',
    lastSuccessAtMs: 2_000,
    error: 'timeout',
  });
});

test('Markets renders unknown summaries until a market read has succeeded', async () => {
  const source = await readFile(new URL('../../src/pages/Markets.tsx', import.meta.url), 'utf8');

  assert.match(source, /const marketReadSucceeded = marketsLastSuccessAtMs !== null/);
  assert.match(source, /marketReadSucceeded \? markets\.length\.toLocaleString\('en-US'\) : 'UNKNOWN'/);
  assert.match(source, /marketReadSucceeded \? fmtMoney\(totalVolume\) : 'UNKNOWN'/);
  assert.match(source, /marketReadSucceeded && rows\.length === 0/);
  assert.match(source, /marketStatus === 'STALE'[\s\S]*STALE LAST-KNOWN/);
  assert.match(source, /marketStatus === 'UNAVAILABLE'[\s\S]*Feed Unavailable/);
});
