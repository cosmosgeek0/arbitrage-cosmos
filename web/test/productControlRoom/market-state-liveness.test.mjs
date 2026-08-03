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

test('Markets withholds rows until canonical, current, and live truth agrees', async () => {
  const source = await readFile(new URL('../../src/pages/Markets.tsx', import.meta.url), 'utf8');

  assert.match(source, /useProductControlRoomContext\(\)/);
  assert.match(source, /const canonicalReady = input\.canonicalContinuity === 'PROVEN'[\s\S]*input\.canonicalMarketFeedReadinessProven/);
  assert.match(source, /input\.marketStatus !== 'CURRENT'/);
  assert.match(source, /input\.marketsLastSuccessAtMs === null/);
  assert.match(source, /input\.marketFreshnessStatus !== 'LIVE'/);
  assert.match(source, /const marketReadSucceeded = marketTruth\.current/);
  assert.match(source, /const pages = marketReadSucceeded \? Math\.max/);
  assert.match(source, /const visible = marketReadSucceeded \? rows\.slice\([\s\S]*\) : \[\]/);
  assert.match(source, /marketReadSucceeded \? markets\.length\.toLocaleString\('en-US'\) : 'UNKNOWN'/);
  assert.match(source, /marketReadSucceeded && volumeCoverageComplete \? fmtMoney\(totalVolume\) : 'UNKNOWN'/);
  assert.match(source, /marketReadSucceeded && rows\.length === 0/);
  assert.match(source, /marketTruth\.reason \?\? 'Waiting for canonical market-source truth and a current live read\.'/);
});

test('Markets withholds incomplete breadth and discloses its coverage', async () => {
  const source = await readFile(new URL('../../src/pages/Markets.tsx', import.meta.url), 'utf8');

  assert.match(source, /const knownChanges24h = markets\.map\(\(market\) => market\.change24hPct\)\.filter\(finite\)/);
  assert.match(source, /const changeCoverageComplete = markets\.length > 0 && knownChanges24h\.length === markets\.length/);
  assert.match(source, /const breadthKnown = marketReadSucceeded && changeCoverageComplete/);
  assert.match(source, /<strong>\{breadthKnown \? `[\s\S]*` : 'UNKNOWN'\}<\/strong>/);
  assert.match(source, /Change Coverage UNKNOWN · \$\{knownChanges24h\.length\.toLocaleString\('en-US'\)\} of \$\{markets\.length\.toLocaleString\('en-US'\)\} rows known/);
});
