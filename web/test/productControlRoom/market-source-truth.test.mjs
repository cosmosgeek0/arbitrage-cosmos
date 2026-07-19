import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  normalizeMarketSourceTime,
  resolveMarketFreshness,
} from '../../src/store.tsx';

test('market freshness requires an exact source timestamp, not socket connectivity', async () => {
  assert.equal(normalizeMarketSourceTime(undefined), null);
  assert.equal(normalizeMarketSourceTime(null), null);
  assert.equal(normalizeMarketSourceTime(Number.NaN), null);

  const exactSourceTimeMs = 1_750_000_000_000;
  assert.equal(normalizeMarketSourceTime(exactSourceTimeMs), exactSourceTimeMs);

  assert.deepEqual(resolveMarketFreshness({
    connected: true,
    error: null,
    sourceTimeMs: null,
    nowMs: exactSourceTimeMs + 1_000,
    staleAfterMs: 12_000,
  }), {
    status: 'UNKNOWN',
    live: false,
    ageMs: null,
  });

  assert.deepEqual(resolveMarketFreshness({
    connected: true,
    error: null,
    sourceTimeMs: exactSourceTimeMs,
    nowMs: exactSourceTimeMs + 1_000,
    staleAfterMs: 12_000,
  }), {
    status: 'LIVE',
    live: true,
    ageMs: 1_000,
  });

  const store = await readFile(new URL('../../src/store.tsx', import.meta.url), 'utf8');
  const markets = await readFile(new URL('../../src/pages/Markets.tsx', import.meta.url), 'utf8');
  assert.equal(
    store.match(/setMarketsUpdatedAt\(normalizeMarketSourceTime\(payload\.updatedAt\)\)/g)?.length,
    2,
    'poll and manual refresh must both preserve source-time absence',
  );
  assert.doesNotMatch(store, /setMarketsUpdatedAt\(payload\.updatedAt \?\? Date\.now\(\)\)/);
  assert.match(markets, /resolveMarketFreshness\(/);
  assert.match(markets, /Freshness Unknown/);
});
