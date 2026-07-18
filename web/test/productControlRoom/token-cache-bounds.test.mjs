import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { BoundedTtlCache } from '../../src/lib/boundedTtlCache.ts';

test('TokenDetail cache evicts expired entries and refreshes LRU order', () => {
  let now = 1_000;
  const cache = new BoundedTtlCache({
    maxEntries: 2,
    ttlMs: 100,
    now: () => now,
  });

  cache.set('btc', 1);
  now += 1;
  cache.set('eth', 2);
  assert.equal(cache.get('btc'), 1, 'a cache hit should refresh LRU order');

  cache.set('sol', 3);
  assert.equal(cache.get('eth'), undefined, 'the least recently used live entry should be evicted');
  assert.equal(cache.get('btc'), 1);
  assert.equal(cache.get('sol'), 3);

  now += 100;
  assert.equal(cache.get('btc'), undefined, 'an entry at its TTL boundary should expire');
  assert.equal(cache.size, 0, 'expired entries should be removed, not merely ignored');
});

test('TokenDetail cache stays bounded while insertion sweeps expired entries', () => {
  let now = 0;
  const cache = new BoundedTtlCache({
    maxEntries: 3,
    ttlMs: 10,
    now: () => now,
  });

  for (let index = 0; index < 100; index += 1) {
    now = index;
    cache.set(`symbol-${index}`, index);
    assert.ok(cache.size <= 3, 'entry count must never exceed the declared bound');
  }

  now = 1_000;
  cache.set('fresh', 101);
  assert.equal(cache.size, 1, 'insertion should reclaim every expired entry');
  assert.equal(cache.get('fresh'), 101);
});

test('TokenDetail uses bounded caches and does not prewarm inactive derivatives tabs', async () => {
  const source = await readFile(new URL('../../src/pages/TokenDetail.tsx', import.meta.url), 'utf8');

  const boundedCaches = source.match(/new BoundedTtlCache</g) ?? [];
  assert.equal(boundedCaches.length, 4, 'each retained TokenDetail dataset cache must have TTL/LRU bounds');
  assert.doesNotMatch(source, /const tabs: IntelTab\[\][\s\S]*?requestIntelDataset\(symbol, next/);
  assert.doesNotMatch(source, /new Map<string, TimedCache</);
});
