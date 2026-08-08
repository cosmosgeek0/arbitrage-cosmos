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

test('News merge keeps the later publication and deterministic item order', async () => {
  const server = await createServer({
    root: new URL('../..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const news = await server.ssrLoadModule('/src/pages/News.tsx');
    assert.equal(typeof news.mergeContextPayload, 'function');

    const current = newsPayload(200, [
      newsItem('shared', 'Newer row content', 200, undefined),
      newsItem('current-only', 'Current-only row', 190, 1),
    ]);
    const delayed = newsPayload(100, [
      newsItem('shared', 'Older row content', 100, 3),
      newsItem('older-only', 'Older unique row', 90, 2),
    ]);

    const delayedMerge = news.mergeContextPayload(delayed, current);
    assert.equal(delayedMerge.fetchedAt, 200);
    assert.equal(delayedMerge.items.find((item) => item.id === 'shared').title, 'Newer row content');
    assert.equal(news.authoritativeNewsImpact(delayedMerge.items.find((item) => item.id === 'shared')), null);
    assert.equal(delayedMerge.items.some((item) => item.id === 'older-only'), true);
    assert.deepEqual(news.mergeContextPayload(delayed, current), delayedMerge);

    const next = newsPayload(300, [newsItem('shared', 'Newest row content', 300, 2)]);
    const nextMerge = news.mergeContextPayload(next, current);
    assert.equal(nextMerge.fetchedAt, 300);
    assert.equal(nextMerge.items.find((item) => item.id === 'shared').title, 'Newest row content');
    assert.equal(news.authoritativeNewsImpact(nextMerge.items.find((item) => item.id === 'shared')), 2);

    const equalVersion = newsPayload(200, [newsItem('shared', 'Ambiguous equal-version row', 250, 3)]);
    assert.equal(
      news.mergeContextPayload(equalVersion, current).items.find((item) => item.id === 'shared').title,
      'Ambiguous equal-version row',
    );
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

function newsPayload(fetchedAt, items) {
  return { source: `source-${fetchedAt}`, fetchedAt, items, sources: [] };
}

function newsItem(id, title, ts, impact) {
  return {
    id,
    title,
    summary: null,
    url: null,
    source: 'Primary',
    channel: 'primary',
    ts,
    timeLabel: '12:00',
    symbols: [],
    tags: [],
    tone: 'idle',
    impact,
  };
}
