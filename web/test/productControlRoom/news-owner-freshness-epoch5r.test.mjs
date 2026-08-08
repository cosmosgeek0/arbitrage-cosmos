import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createServer } from 'vite';

const NOW = 1_800_000_000_000;
const ITEM_NOW = 1_700_000_000_000;

test('Epoch 5R News keeps context and Binance owner freshness independent and fail-closed', async () => {
  const server = await createServer({
    root: new URL('../..', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const news = await server.ssrLoadModule('/src/pages/News.tsx');
    assert.equal(news.NEWS_OWNER_MAX_AGE_MS, 5 * 60_000);
    assert.equal(typeof news.projectNewsOwnerTruth, 'function');
    assert.equal(typeof news.newsOwnerAgeLabel, 'function');

    const staleContext = news.projectNewsOwnerTruth({
      fetchedAt: NOW - 7 * 60 * 60_000,
      reportedState: 'STREAMING',
      now: NOW,
    });
    const currentBinance = news.projectNewsOwnerTruth({
      fetchedAt: NOW - 60_000,
      reportedState: 'POLLING',
      now: NOW,
    });

    assert.deepEqual(
      { state: staleContext.reportedState, freshness: staleContext.freshness, tone: staleContext.tone },
      { state: 'STREAMING', freshness: 'STALE', tone: 'stale' },
    );
    assert.deepEqual(
      { state: currentBinance.reportedState, freshness: currentBinance.freshness, tone: currentBinance.tone },
      { state: 'POLLING', freshness: 'CURRENT', tone: 'current' },
    );
    assert.equal(news.newsOwnerAgeLabel(staleContext), '7h Ago');
    assert.equal(news.newsOwnerAgeLabel(currentBinance), '1m Ago');

    assert.equal(news.projectNewsOwnerTruth({
      fetchedAt: NOW - news.NEWS_OWNER_MAX_AGE_MS,
      reportedState: 'LIVE',
      now: NOW,
    }).freshness, 'CURRENT');
    assert.equal(news.projectNewsOwnerTruth({
      fetchedAt: NOW - news.NEWS_OWNER_MAX_AGE_MS - 1,
      reportedState: 'LIVE',
      now: NOW,
    }).freshness, 'STALE');

    const futureReadback = news.projectNewsOwnerTruth({
      fetchedAt: NOW + 1,
      reportedState: 'LIVE',
      now: NOW,
    });
    assert.deepEqual(
      { state: futureReadback.reportedState, freshness: futureReadback.freshness, age: futureReadback.ageMs, tone: futureReadback.tone },
      { state: 'UNAVAILABLE', freshness: 'UNMEASURED', age: null, tone: 'error' },
    );

    const loadingContext = news.projectNewsOwnerTruth({
      fetchedAt: null,
      reportedState: 'LOADING',
      now: NOW,
    });
    assert.deepEqual(
      { state: loadingContext.reportedState, freshness: loadingContext.freshness, tone: loadingContext.tone },
      { state: 'LOADING', freshness: 'UNMEASURED', tone: 'loading' },
    );
    assert.equal(news.newsOwnerHeadlineClass(loadingContext, false), 'neutral');
    assert.equal(news.newsOwnerHeadlineClass(staleContext, true), 'reconnecting');
    assert.equal(news.newsOwnerHeadlineClass(currentBinance, false), '');

    const allErrorEnvelope = contextPayload({
      fetchedAt: NOW,
      sources: [contextSource('failed-owner', 'error', NOW)],
      items: [contextItem('error-row', NOW - 1_000)],
    });
    const allErrorObservation = news.newsContextOwnerObservation(allErrorEnvelope, false, true, NOW);
    const allErrorTruth = news.projectNewsOwnerTruth({ ...allErrorObservation, now: NOW });
    assert.deepEqual(allErrorObservation, { reportedState: 'ERROR', fetchedAt: null });
    assert.deepEqual(
      { freshness: allErrorTruth.freshness, tone: allErrorTruth.tone, css: news.newsOwnerHeadlineClass(allErrorTruth, true) },
      { freshness: 'UNMEASURED', tone: 'error', css: 'error' },
    );
    assert.deepEqual(
      news.readFeedCache(cacheStorage({ context: allErrorEnvelope, binance: null })).context,
      allErrorEnvelope,
    );
    for (const invalidSource of [
      { ...contextSource('invalid-status', 'live', NOW), status: 'healthy' },
      { ...contextSource('missing-live-time', 'live', NOW), fetchedAt: null },
      { ...contextSource('negative-count', 'error', NOW), count: -1 },
      { ...contextSource('invalid-detail', 'delayed', NOW), detail: null },
    ]) {
      const invalidEnvelope = contextPayload({
        fetchedAt: NOW,
        sources: [invalidSource],
        items: [],
      });
      const storage = cacheStorage({ context: invalidEnvelope, binance: null });
      assert.deepEqual(news.readFeedCache(storage), { context: null, binance: null });
      assert.deepEqual(storage.removed, ['cosmos-news-feed-cache-v4']);
    }
    const duplicatedSources = contextPayload({
      fetchedAt: NOW,
      sources: [
        contextSource('duplicate', 'live', NOW - 1_000),
        contextSource('duplicate', 'delayed', NOW - 2_000),
      ],
      items: [],
    });
    assert.deepEqual(
      news.readFeedCache(cacheStorage({ context: duplicatedSources, binance: null })),
      { context: null, binance: null },
    );

    const currentContext = contextPayload({
      fetchedAt: NOW,
      sources: [contextSource('primary-owner', 'live', NOW - 1_000)],
      items: [
        contextItem('shared-row', ITEM_NOW - 1_000, 'Current Publication'),
        contextItem('current-only', ITEM_NOW - 2_000, 'Current Only'),
      ],
    });
    const equalTimeDowngrade = contextPayload({
      fetchedAt: NOW,
      sources: [contextSource('primary-owner', 'delayed', NOW - 1_000)],
      items: [
        contextItem('shared-row', ITEM_NOW - 1_000, 'Later Equal-Time Publication'),
        contextItem('incoming-only', ITEM_NOW - 3_000, 'Incoming Only'),
      ],
    });
    const downgraded = news.mergeContextPayload(equalTimeDowngrade, currentContext);
    const downgradeObservation = news.newsContextOwnerObservation(downgraded, false, true, NOW);
    const downgradeTruth = news.projectNewsOwnerTruth({ ...downgradeObservation, now: NOW });
    assert.equal(downgraded.sources[0].status, 'delayed');
    assert.equal(downgraded.items.find((item) => item.id === 'shared-row').title, 'Later Equal-Time Publication');
    assert.deepEqual(
      downgraded.items.map((item) => item.id),
      ['shared-row', 'current-only', 'incoming-only'],
    );
    assert.deepEqual(downgradeObservation, { reportedState: 'DELAYED', fetchedAt: null });
    assert.deepEqual(
      { freshness: downgradeTruth.freshness, tone: downgradeTruth.tone, css: news.newsOwnerHeadlineClass(downgradeTruth, true) },
      { freshness: 'UNMEASURED', tone: 'delayed', css: 'reconnecting' },
    );

    const someLiveEnvelope = contextPayload({
      fetchedAt: NOW,
      sources: [
        contextSource('older-live', 'live', NOW - 120_000),
        contextSource('newer-live', 'live', NOW - 30_000),
        contextSource('failed-owner', 'error', NOW),
      ],
      items: [contextItem('live-row', NOW - 30_000)],
    });
    const someLiveObservation = news.newsContextOwnerObservation(someLiveEnvelope, false, true, NOW);
    const someLiveTruth = news.projectNewsOwnerTruth({ ...someLiveObservation, now: NOW });
    assert.deepEqual(someLiveObservation, { reportedState: 'STREAMING', fetchedAt: NOW - 30_000 });
    assert.deepEqual(
      { freshness: someLiveTruth.freshness, tone: someLiveTruth.tone, css: news.newsOwnerHeadlineClass(someLiveTruth, true) },
      { freshness: 'CURRENT', tone: 'current', css: 'streaming' },
    );

    const [source, css] = await Promise.all([
      readFile(new URL('../../src/pages/News.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../../src/pages/News.css', import.meta.url), 'utf8'),
    ]);
    assert.doesNotMatch(source, /lastCheckedAt/);
    assert.doesNotMatch(source, /Math\.max\(initial\.context\?\.fetchedAt[\s\S]*initial\.binance\?\.fetchedAt/);
    assert.doesNotMatch(source, /fetchedAt:\s*context\?\.fetchedAt/);
    assert.match(source, /newsContextOwnerObservation\(context, contextFailed, streamConnected, now\)/);
    assert.match(source, /newsOwnerLabel\('Context', contextTruth\)/);
    assert.match(source, /className=\{`lix-live \$\{newsOwnerHeadlineClass\(contextTruth, streamConnected\)\}`\}/);
    assert.match(source, /\['Context', contextTruth\],[\s\S]*\['Binance', binanceTruth\]/);
    assert.match(source, /sourceOwnerTruth\(source, now\)/);
    assert.match(source, /\{truth\.reportedState\} \/ \{truth\.freshness\}/);
    assert.match(source, /\{newsOwnerAgeLabel\(truth\)\}/);
    assert.match(css, /\.newsx-page \.lix-live\.neutral i\s*\{\s*background:\s*var\(--faint\)/);
    assert.match(css, /@container \(max-width: 440px\)[\s\S]*grid-template-areas:[\s\S]*"state count"[\s\S]*"age count"/);
    assert.match(css, /\.newsx-page \.newsx-source-status strong\s*\{[\s\S]*grid-area:\s*count/);
  } finally {
    await server.close();
  }
});

function contextPayload({ fetchedAt, sources, items }) {
  return {
    source: 'hostile-test',
    fetchedAt,
    sources,
    items,
  };
}

function cacheStorage(value) {
  return {
    removed: [],
    getItem() { return JSON.stringify(value); },
    removeItem(key) { this.removed.push(key); },
  };
}

function contextSource(key, status, fetchedAt) {
  return {
    key,
    label: key,
    status,
    detail: `${status} test owner`,
    fetchedAt,
    count: 1,
  };
}

function contextItem(id, ts, title = id) {
  return {
    id,
    title,
    summary: null,
    url: null,
    source: 'Hostile Test',
    sourceKey: 'hostile-test',
    sourceDomain: null,
    channel: 'primary',
    ts,
    publishedDay: null,
    timeLabel: 'Observed',
    symbols: [],
    tags: [],
    category: 'Markets',
    tone: 'idle',
    impact: null,
  };
}
