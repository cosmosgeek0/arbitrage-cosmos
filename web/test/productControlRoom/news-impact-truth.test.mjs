import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createServer } from 'vite';

test('News preserves missing impact as UNKNOWN and excludes it from scored totals', async () => {
  const server = await createServer({
    root: new URL('../..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const news = await server.ssrLoadModule('/src/pages/News.tsx');
    assert.equal(typeof news.authoritativeNewsImpact, 'function');
    assert.equal(typeof news.summarizeNewsImpacts, 'function');

    const unscoredSecurityHeadline = {
      impact: undefined,
      title: 'Critical bridge exploit drains funds',
      channel: 'primary',
      tags: ['Security'],
    };
    assert.equal(news.authoritativeNewsImpact(unscoredSecurityHeadline), null);

    assert.deepEqual(news.summarizeNewsImpacts([
      unscoredSecurityHeadline,
      { impact: null },
      { impact: 3 },
      { impact: 2 },
      { impact: 1 },
      { impact: 0 },
    ]), {
      high: 1,
      medium: 1,
      low: 1,
      unknown: 3,
      scored: 3,
    });

    const source = await readFile(new URL('../../src/pages/News.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fallbackImpact/);
    assert.doesNotMatch(source, /item\.impact\s*\?\?\s*2/);
  } finally {
    await server.close();
  }
});

test('News rejects and removes invalid cached payloads before they reach feed state', async () => {
  const server = await createServer({
    root: new URL('../..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const news = await server.ssrLoadModule('/src/pages/News.tsx');
    assert.equal(typeof news.readFeedCache, 'function');

    const invalidStorage = fakeStorage(JSON.stringify({
      context: { source: 'cache', fetchedAt: 'not-a-timestamp', items: [], sources: [] },
      binance: null,
    }));
    assert.deepEqual(news.readFeedCache(invalidStorage), { context: null, binance: null });
    assert.deepEqual(invalidStorage.removed, ['cosmos-news-feed-cache-v4']);

    const malformedStorage = fakeStorage('{broken-json');
    assert.deepEqual(news.readFeedCache(malformedStorage), { context: null, binance: null });
    assert.deepEqual(malformedStorage.removed, ['cosmos-news-feed-cache-v4']);

    const validContext = {
      source: 'cache',
      fetchedAt: 1_700_000_000_000,
      items: [{
        id: 'missing-impact',
        title: 'Server omitted impact',
        summary: null,
        url: null,
        source: 'Primary',
        channel: 'primary',
        ts: 1_700_000_000_000,
        timeLabel: '12:00',
        symbols: [],
        tags: [],
        tone: 'idle',
      }],
      sources: [{
        key: 'primary',
        label: 'Primary',
        status: 'live',
        detail: 'Cached source',
        fetchedAt: 1_700_000_000_000,
        count: 1,
      }],
    };
    const validStorage = fakeStorage(JSON.stringify({ context: validContext, binance: null }));
    assert.deepEqual(news.readFeedCache(validStorage), { context: validContext, binance: null });
    assert.deepEqual(validStorage.removed, []);
    assert.equal(news.authoritativeNewsImpact(news.readFeedCache(validStorage).context.items[0]), null);
  } finally {
    await server.close();
  }
});

function fakeStorage(value) {
  return {
    removed: [],
    getItem() { return value; },
    removeItem(key) { this.removed.push(key); },
  };
}
