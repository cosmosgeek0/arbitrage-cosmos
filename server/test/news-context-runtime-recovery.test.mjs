import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const originalFetch = globalThis.fetch;
const originalEnvironment = Object.freeze({
  DATA_DIR: process.env.DATA_DIR,
  DATA_DIR_LOGICAL_LEASE_ROOT: process.env.DATA_DIR_LOGICAL_LEASE_ROOT,
  SKIP_DOTENV: process.env.SKIP_DOTENV,
});
const suiteTemp = await mkdtemp(path.join(os.tmpdir(), 'cosmos-news-runtime-'));
const suiteRoot = await realpath(suiteTemp);
const suiteDataDir = path.join(suiteRoot, 'data');
await mkdir(suiteDataDir, { recursive: true, mode: 0o700 });
Object.assign(process.env, {
  DATA_DIR: suiteDataDir,
  DATA_DIR_LOGICAL_LEASE_ROOT: path.join(suiteRoot, 'logical-runtime'),
  SKIP_DOTENV: '1',
});

async function flushMicrotasks(rounds = 24) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function emptyUpstreamResponse(init = {}) {
  const accept = new Headers(init.headers).get('accept')?.toLowerCase() ?? '';
  if (accept.includes('json') && !accept.includes('html') && !accept.includes('xml')) {
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  }
  if (accept.includes('html')) {
    return new Response('<html><body></body></html>', { headers: { 'content-type': 'text/html' } });
  }
  return new Response('<rss><channel></channel></rss>', {
    headers: { 'content-type': 'application/rss+xml' },
  });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test.after(async () => {
  try {
    const environment = await import('../src/bootstrap/environment.ts');
    environment.DATA_DIR_LEASE.release();
  } finally {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    let cleanupError = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await rm(suiteRoot, { recursive: true, force: true });
        cleanupError = null;
        break;
      } catch (error) {
        cleanupError = error;
        if (error?.code !== 'ENOTEMPTY' && error?.code !== 'EBUSY') throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    if (cleanupError) throw cleanupError;
  }
});

test('browser reads return only the retained publication and never start upstream work', { concurrency: false }, async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Promise(() => undefined);
  };
  const news = await import(`../src/services/newsContext.ts?publication-only=${Date.now()}`);

  const first = await news.getNewsContext(false);
  const second = await news.getNewsContext(true);
  let subscribed = null;
  const unsubscribe = news.subscribeNewsContext((payload) => { subscribed = payload; });
  unsubscribe();

  assert.equal(fetchCalls, 0);
  assert.equal(news.newsContextStatus().refreshing, false);
  assert.equal(first, second);
  assert.deepEqual(subscribed, first);
  assert.ok(first.sources.length > 50);
  assert.ok(first.sources.every((source) => source.status !== 'live'));
});

test('archive work crossing a starved deadline cannot leak rejected rows into later publication or disk', { concurrency: false }, async (t) => {
  const startAt = 1_935_000_000_000;
  const expiredTitle = 'Bitcoin market EXPIRED ARCHIVE ROW MUST NOT LEAK';
  const validTitle = 'Bitcoin market VALID LATER ARCHIVE PUBLICATION';
  const archivePath = path.join(suiteDataDir, 'news-archive.json');
  const originalStringify = JSON.stringify;
  const expiredPublishedAt = new Date(startAt - 1_000).toISOString();
  const validPublishedAt = new Date(startAt + 300_000).toISOString();
  let now = startAt;
  let title = expiredTitle;
  let publishedAt = expiredPublishedAt;
  let crossedDeadlineDuringArchiveWork = false;

  await rm(archivePath, { force: true });
  t.after(() => rm(archivePath, { force: true }));
  t.mock.method(Date, 'now', () => now);
  t.mock.method(JSON, 'stringify', function stringifyWithStarvedDeadline(value, ...rest) {
    if (!crossedDeadlineDuringArchiveWork
      && Array.isArray(value)
      && value.some((item) => item?.title === expiredTitle)) {
      crossedDeadlineDuringArchiveWork = true;
      queueMicrotask(() => {
        now = startAt + 20_001;
      });
    }
    return Reflect.apply(originalStringify, JSON, [value, ...rest]);
  });
  globalThis.fetch = async (input, init = {}) => {
    if (String(input) !== 'https://www.federalreserve.gov/feeds/press_all.xml') {
      return emptyUpstreamResponse(init);
    }
    return new Response(
      `<rss><channel><item><title>${title}</title><link>https://www.federalreserve.gov/newsevents/pressreleases/cosmos.htm</link><guid>${title}</guid><pubDate>${publishedAt}</pubDate><description>Bitcoin market fixture</description></item></channel></rss>`,
      { headers: { 'content-type': 'application/rss+xml' } },
    );
  };
  const news = await import(`../src/services/newsContext.ts?archive-deadline=${startAt}`);

  await assert.rejects(
    news.refreshNewsContextNow(),
    /News context refresh deadline exceeded/,
  );
  assert.equal(crossedDeadlineDuringArchiveWork, true, 'archive serialization queues work ahead of the starved deadline timer');
  assert.equal(now, startAt + 20_001);
  assert.equal(
    (await news.getNewsContext(false)).items.some((item) => item.title === expiredTitle),
    false,
    'the rejected row never reaches the retained publication',
  );

  title = validTitle;
  publishedAt = validPublishedAt;
  now = startAt + 300_001;
  const later = await news.refreshNewsContextNow();
  assert.ok(later.items.some((item) => item.title === validTitle));
  assert.equal(
    later.items.some((item) => item.title === expiredTitle),
    false,
    'the rejected generation does not contaminate a later publication',
  );
  assert.equal(
    (await news.getNewsContext(false)).items.some((item) => item.title === expiredTitle),
    false,
  );

  let persisted = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const candidate = JSON.parse(await readFile(archivePath, 'utf8'));
      if (Array.isArray(candidate) && candidate.some((item) => item.title === validTitle)) {
        persisted = candidate;
        break;
      }
    } catch {
      // The accepted persistence job has not renamed its temporary file yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(Array.isArray(persisted), 'the accepted later archive reaches disk');
  assert.ok(persisted.some((item) => item.title === validTitle));
  assert.equal(
    persisted.some((item) => item.title === expiredTitle),
    false,
    'the rejected generation never contaminates the persisted archive',
  );
});

test('deadline-rejected source caches roll back before the immediate next generation', { concurrency: false }, async (t) => {
  const startAt = 1_936_000_000_000;
  const rejectedTitle = 'Bitcoin market REJECTED SOURCE CACHE ROW';
  const validTitle = 'Bitcoin market VALID NEXT GENERATION ROW';
  let now = startAt;
  let title = rejectedTitle;
  let publishedAt = new Date(startAt - 1_000).toISOString();
  let fedCalls = 0;
  let treeAttempts = 0;
  let resolveTree = null;

  t.mock.method(Date, 'now', () => now);
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.toString() === 'https://www.federalreserve.gov/feeds/press_all.xml') {
      fedCalls += 1;
      return new Response(
        `<rss><channel><item><title>${title}</title><link>https://www.federalreserve.gov/newsevents/pressreleases/cache-rollback.htm</link><guid>${title}</guid><pubDate>${publishedAt}</pubDate><description>Bitcoin market fixture</description></item></channel></rss>`,
        { headers: { 'content-type': 'application/rss+xml' } },
      );
    }
    if (url.hostname === 'news.treeofalpha.com') {
      treeAttempts += 1;
      if (treeAttempts === 1) {
        return new Promise((resolve) => { resolveTree = resolve; });
      }
    }
    return emptyUpstreamResponse(init);
  };
  const news = await import(`../src/services/newsContext.ts?source-cache-rollback=${startAt}`);

  const rejectedRefresh = news.refreshNewsContextNow();
  await flushMicrotasks(512);
  assert.equal(fedCalls, 1);
  assert.ok(resolveTree, 'the first generation remains open after caching the Fed row');
  now = startAt + 20_001;
  resolveTree(new Response('[]', { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(rejectedRefresh, /News context refresh deadline exceeded/);

  title = validTitle;
  publishedAt = new Date(startAt + 20_001).toISOString();
  now = startAt + 20_002;
  const later = await news.refreshNewsContextNow();

  assert.equal(fedCalls, 2, 'the rejected TTL cache cannot suppress the next source request');
  assert.ok(later.items.some((item) => item.title === validTitle));
  assert.equal(
    later.items.some((item) => item.title === rejectedTitle),
    false,
    'the rejected source row cannot contaminate the next accepted publication',
  );
});

test('poisoned URLs relinquish permits while retaining identity and healthy sources continue', { concurrency: false }, async (t) => {
  const startAt = 1_900_000_000_000;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: startAt });
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const key = `${String(input)}:${new Headers(init.headers).get('accept') ?? ''}`;
    calls.push(key);
    if (calls.length <= 6) return new Promise(() => undefined);
    return emptyUpstreamResponse(init);
  };
  const news = await import(`../src/services/newsContext.ts?hostile-abort=${startAt}`);

  news.startNewsContextRuntime();
  await flushMicrotasks();
  assert.equal(news.newsContextStatus().refreshing, true);
  assert.equal(calls.length, 6, 'one sweep initially owns at most six raw upstream requests');
  const poisonedKeys = [...calls];

  const beforeDeadlineCalls = calls.length;
  const publishedWhileBusy = await news.getNewsContext(false);
  assert.equal(calls.length, beforeDeadlineCalls, 'GET does not join the active sweep');
  assert.ok(publishedWhileBusy.sources.every((source) => source.status !== 'live'));

  t.mock.timers.tick(16_350);
  await flushMicrotasks(512);
  assert.ok(calls.length > 6, 'quarantined raw transports release logical permits for later healthy URLs');
  for (const key of poisonedKeys) {
    assert.equal(calls.filter((candidate) => candidate === key).length, 1, 'a poisoned URL is never duplicated');
  }

  t.mock.timers.tick(3_650);
  await flushMicrotasks(128);
  assert.equal(news.newsContextStatus().refreshing, false, 'the published generation releases at its hard deadline');
  const recovered = await news.getNewsContext(false);
  assert.ok(recovered.sources.some((source) => source.status === 'live'), 'healthy sources still publish');
  assert.ok(recovered.sources.some((source) => source.status !== 'live'), 'poisoned sources remain non-green');
  news.stopNewsContextRuntime();
});

test('a late old-generation body cannot join or publish through a later generation', { concurrency: false }, async (t) => {
  const startAt = 1_910_000_000_000;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: startAt });
  const calls = [];
  let treePending = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.hostname === 'news.treeofalpha.com') {
      return new Promise((resolve) => { treePending = { resolve, init }; });
    }
    return emptyUpstreamResponse(init);
  };
  const news = await import(`../src/services/newsContext.ts?late-generation=${startAt}`);

  const firstRefresh = news.refreshNewsContextNow();
  await flushMicrotasks(256);
  assert.ok(treePending, 'the first generation owns the Tree transport');
  t.mock.timers.tick(16_350);
  await flushMicrotasks(512);
  await firstRefresh;

  t.mock.timers.tick(15_001);
  const callsBeforeSecondGeneration = calls.length;
  const secondRefresh = news.refreshNewsContextNow();
  await flushMicrotasks(128);
  assert.ok(calls.length > callsBeforeSecondGeneration, 'the later generation reacquires healthy URLs');
  const treeCallsBeforeLateSettlement = calls.filter((value) => value.includes('news.treeofalpha.com')).length;
  let secondOutcome = 'pending';
  void secondRefresh.then(
    () => { secondOutcome = 'resolved'; },
    () => { secondOutcome = 'rejected'; },
  );
  await flushMicrotasks(512);
  assert.equal(secondOutcome, 'resolved', 'the later generation must settle without joining old raw work');
  const second = await secondRefresh;

  treePending.resolve(new Response(JSON.stringify([{
    _id: 'old-generation-row',
    title: 'OLD GENERATION MUST NOT PUBLISH',
    time: startAt + 1_000,
    sourceName: 'Hostile Fixture',
  }]), { headers: { 'content-type': 'application/json' } }));
  await flushMicrotasks(128);

  assert.equal(treeCallsBeforeLateSettlement, 1);
  assert.equal(
    calls.filter((value) => value.includes('news.treeofalpha.com')).length,
    1,
    'the later generation rejects the quarantined key instead of duplicating or joining it',
  );
  assert.equal(second.items.some((item) => item.title === 'OLD GENERATION MUST NOT PUBLISH'), false);
  assert.equal(
    (await news.getNewsContext(false)).items.some((item) => item.title === 'OLD GENERATION MUST NOT PUBLISH'),
    false,
  );
  news.stopNewsContextRuntime();
});

test('a body that finishes after fetch abort cannot publish its late bytes', { concurrency: false }, async (t) => {
  const startAt = 1_920_000_000_000;
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: startAt });
  let treeAttempts = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname !== 'news.treeofalpha.com') return emptyUpstreamResponse(init);
    treeAttempts += 1;
    if (treeAttempts > 1) {
      return new Response('[]', { headers: { 'content-type': 'application/json' } });
    }
    const lateBody = new ReadableStream({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify([{
            _id: 'late-body-row',
            title: 'LATE BODY MUST NOT PUBLISH',
            time: startAt + 1_000,
            sourceName: 'Hostile Fixture',
          }])));
          controller.close();
        }, 9_000);
      },
    });
    return new Response(lateBody, { headers: { 'content-type': 'application/json' } });
  };
  const news = await import(`../src/services/newsContext.ts?late-body=${startAt}`);

  const refresh = news.refreshNewsContextNow();
  await flushMicrotasks(256);
  t.mock.timers.tick(8_000);
  await flushMicrotasks(64);
  t.mock.timers.tick(1_000);
  await flushMicrotasks(128);
  t.mock.timers.tick(350);
  await flushMicrotasks(512);
  const published = await refresh;

  assert.equal(treeAttempts, 2, 'the timed-out body is rejected and the bounded retry owns a new attempt');
  assert.equal(published.items.some((item) => item.title === 'LATE BODY MUST NOT PUBLISH'), false);
  assert.equal(
    (await news.getNewsContext(false)).items.some((item) => item.title === 'LATE BODY MUST NOT PUBLISH'),
    false,
  );
});

test('work settling after its generation deadline is rejected even before the deadline timer runs', { concurrency: false }, async (t) => {
  const startAt = 1_930_000_000_000;
  let now = startAt;
  t.mock.method(Date, 'now', () => now);
  let resolveTree = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'news.treeofalpha.com') {
      return new Promise((resolve) => { resolveTree = resolve; });
    }
    return emptyUpstreamResponse(init);
  };
  const news = await import(`../src/services/newsContext.ts?starved-deadline=${startAt}`);

  const refresh = news.refreshNewsContextNow();
  await flushMicrotasks(256);
  assert.ok(resolveTree);
  now = startAt + 20_001;
  resolveTree(new Response('[]', { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(refresh, /News context refresh deadline exceeded/);
  assert.equal(news.newsContextStatus().refreshing, false);
  assert.ok((await news.getNewsContext(false)).sources.every((source) => source.status !== 'live'));
});

test('a zero-live sweep cannot restamp bootstrap or replace a retained live publication', { concurrency: false }, async (t) => {
  const startAt = 1_940_000_000_000;
  let now = startAt;
  let upstreamMode = 'error';
  t.mock.method(Date, 'now', () => now);
  globalThis.fetch = async (_input, init = {}) => upstreamMode === 'live'
    ? emptyUpstreamResponse(init)
    : new Response('', { status: 400 });
  const news = await import(`../src/services/newsContext.ts?zero-live=${startAt}`);

  const bootstrap = await news.getNewsContext(false);
  assert.equal(bootstrap.fetchedAt, null, 'bootstrap has no measured source observation time');
  now = startAt + 1;
  await assert.rejects(
    news.refreshNewsContextNow(),
    /News context refresh observed zero live sources/,
  );
  const retainedBootstrap = await news.getNewsContext(false);
  assert.equal(retainedBootstrap.fetchedAt, null, 'zero-live publication keeps source time absent');
  assert.equal(retainedBootstrap.sources.filter((source) => source.status === 'live').length, 0);

  upstreamMode = 'live';
  now = startAt + 20_000;
  const live = await news.refreshNewsContextNow();
  assert.ok(live.sources.some((source) => source.status === 'live'));
  const liveFetchedAt = live.fetchedAt;
  const observed = [];
  const unsubscribe = news.subscribeNewsContext((payload) => observed.push(payload));

  upstreamMode = 'error';
  now = liveFetchedAt + 300_000;
  await assert.rejects(
    news.refreshNewsContextNow(),
    /News context refresh observed zero live sources/,
  );
  const retainedFailure = await news.getNewsContext(false);
  unsubscribe();

  assert.equal(retainedFailure.fetchedAt, liveFetchedAt, 'failed sweep must retain the prior publication time');
  assert.notEqual(retainedFailure.fetchedAt, now, 'failed sweep must not mint a current envelope');
  assert.equal(retainedFailure.sources.filter((source) => source.status === 'live').length, 0);
  assert.ok(retainedFailure.sources.some((source) => source.status === 'delayed'));
  assert.equal(observed.at(-1).fetchedAt, liveFetchedAt);
  assert.equal(observed.at(-1).sources.filter((source) => source.status === 'live').length, 0);
});

test('aged retained live source facts downgrade to delayed without a GET refresh', { concurrency: false }, async (t) => {
  let fetchCalls = 0;
  globalThis.fetch = async (_input, init = {}) => {
    fetchCalls += 1;
    return emptyUpstreamResponse(init);
  };
  const news = await import(`../src/services/newsContext.ts?stale-publication=${Date.now()}`);

  const fresh = await news.refreshNewsContextNow();
  assert.ok(fresh.sources.some((source) => source.status === 'live'));
  const callsAfterPublication = fetchCalls;

  let now = fresh.fetchedAt + 120_001;
  t.mock.method(Date, 'now', () => now);
  const stale = await news.getNewsContext(false);
  assert.equal(fetchCalls, callsAfterPublication);
  assert.equal(stale.sources.filter((source) => source.status === 'live').length, 0);
  assert.ok(stale.sources.some((source) => (
    source.status === 'delayed' && source.detail.includes('Published snapshot stale')
  )));

  now = fresh.fetchedAt + 119_000;
  const rewound = await news.getNewsContext(false);
  assert.equal(
    rewound.sources.filter((source) => source.status === 'live').length,
    0,
    'once stale, the same publication cannot become live again when the clock moves backward',
  );
});

test('a backward runtime clock makes retained live publication truth non-green', { concurrency: false }, async (t) => {
  let fetchCalls = 0;
  globalThis.fetch = async (_input, init = {}) => {
    fetchCalls += 1;
    return emptyUpstreamResponse(init);
  };
  const news = await import(`../src/services/newsContext.ts?backward-clock=${Date.now()}`);
  const fresh = await news.refreshNewsContextNow();
  assert.ok(fresh.sources.some((source) => source.status === 'live'));
  const callsAfterPublication = fetchCalls;

  t.mock.timers.enable({
    apis: ['Date'],
    now: fresh.fetchedAt - 1,
  });
  const nonMonotonic = await news.getNewsContext(false);
  assert.equal(fetchCalls, callsAfterPublication);
  assert.equal(nonMonotonic.sources.filter((source) => source.status === 'live').length, 0);
  assert.ok(nonMonotonic.sources.some((source) => (
    source.status === 'delayed' && source.detail.includes('ahead of the runtime clock')
  )));
});
