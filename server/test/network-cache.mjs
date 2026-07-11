import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const originalFetch = globalThis.fetch;
const sourceMode = process.env.NETWORK_TEST_SOURCE === '1';
const modulePath = (relative) => sourceMode ? `../src/${relative}.ts` : `../dist/${relative}.js`;

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('Binance REST canonicalizes cache keys and single-flights identical work', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.protocol, 'https:');
    assert.equal(url.searchParams.get('limit'), '1000');
    return jsonResponse([{ fundingTime: 1_700_000_000_000, fundingRate: '0.0001' }]);
  };
  const rest = await import(`${modulePath('binance/rest')}?singleflight=${Date.now()}`);
  const [first, second] = await Promise.all([
    rest.fetchFundingHist('BTCUSDT', 1_001),
    rest.fetchFundingHist('BTCUSDT', 9_999),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first, [{ t: 1_700_000_000_000, ratePct: 0.01 }]);
  assert.deepEqual(second, first);
});

test('Binance REST rejects redirects, wrong media types, and oversized bodies without exposing URLs', { concurrency: false }, async () => {
  const rest = await import(`${modulePath('binance/rest')}?boundaries=${Date.now()}`);

  globalThis.fetch = async () => new Response('', {
    status: 302,
    headers: { location: 'https://example.invalid/redirect', 'content-type': 'application/json' },
  });
  await assert.rejects(rest.fetchBookTicker('REDIRECTUSDT'), /bookTicker HTTP 302/);

  globalThis.fetch = async () => new Response('{}', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(rest.fetchBookTicker('BADTYPEUSDT'), /bookTicker invalid content type/);

  globalThis.fetch = async () => new Response('[]', {
    headers: { 'content-type': 'application/json', 'content-length': String(20 * 1024 * 1024) },
  });
  await assert.rejects(rest.fetchFundingHist('OVERSIZEUSDT', 100), /fundingRate response too large/);
});

test('money flow shares one bounded pagination walk and preserves its response schema', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse([{
      p: '100',
      q: '2',
      T: Date.now() - 16 * 60_000,
      m: false,
    }]);
  };
  const moneyflow = await import(`${modulePath('binance/moneyflow')}?singleflight=${Date.now()}`);
  const [first, second] = await Promise.all([
    moneyflow.fetchMoneyFlow('BTCUSDT', '15m'),
    moneyflow.fetchMoneyFlow('BTCUSDT', '15m'),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.equal(first.symbol, 'BTCUSDT');
  assert.equal(first.window, '15m');
  assert.deepEqual(Object.keys(first.large).sort(), ['buy', 'sell']);
  for (const key of ['totalBuy', 'totalSell', 'inflow', 'trades', 'coveredMs', 'windowMs', 'fetchedAt']) {
    assert.equal(Number.isFinite(first[key]), true, key);
  }
});

test('profile lookup single-flights misses and honors its negative cache', { concurrency: false }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'cosmos-profile-test-'));
  process.env.PROFILE_CACHE = path.join(temp, 'profiles.json');
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ coins: [] });
  };
  const profile = await import(`${modulePath('binance/profile')}?negative=${Date.now()}`);
  const base = 'ZZZNEGATIVECACHE';
  const [first, second] = await Promise.all([profile.tokenProfile(base), profile.tokenProfile(base)]);
  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(calls, 1);
  assert.equal(await profile.tokenProfile(base), null);
  assert.equal(calls, 1);
  await profile.flushProfileCache();
  const persisted = JSON.parse(await readFile(process.env.PROFILE_CACHE, 'utf8'));
  assert.equal(Object.keys(persisted).length, 1);
  assert.equal((await stat(process.env.PROFILE_CACHE)).size <= 16 * 1024 * 1024, true);
  delete process.env.PROFILE_CACHE;
});

test('news archive sanitizes retained strings and URLs and never follows a disallowed redirect', { concurrency: false }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'cosmos-news-test-'));
  process.env.DATA_DIR = temp;
  await writeFile(path.join(temp, 'news-archive.json'), JSON.stringify([{
    id: `archive:${'x'.repeat(600)}`,
    title: `Market update ${'x'.repeat(2_000)}`,
    summary: 'summary',
    url: 'javascript:alert(1)',
    source: 'Archive',
    sourceKey: 'archive',
    sourceDomain: 'example.com',
    channel: 'rss',
    ts: Date.now() - 1_000,
    timeLabel: 'stale',
    symbols: [],
    tags: [],
    category: 'Markets',
    tone: 'idle',
    impact: 1,
  }]));

  let disallowedFollow = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.protocol, 'https:');
    if (url.hostname === 'www.safe.gov.cn') {
      return new Response('', { status: 302, headers: { location: 'https://example.invalid/private' } });
    }
    if (url.hostname === 'example.invalid') disallowedFollow = true;
    const accept = new Headers(init?.headers).get('accept')?.toLowerCase() ?? '';
    if (accept.includes('json') && !accept.includes('html') && !accept.includes('xml')) return jsonResponse([]);
    if (accept.includes('html')) return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    return new Response('<rss></rss>', { headers: { 'content-type': 'application/rss+xml' } });
  };
  const news = await import(`${modulePath('services/newsContext')}?sanitize=${Date.now()}`);
  const payload = await news.getNewsContext(false);
  assert.equal(payload.items[0].title.length, 320);
  assert.equal(payload.items[0].url, null);
  assert.notEqual(payload.items[0].timeLabel, 'stale');
  await news.refreshNewsContextNow();
  assert.equal(disallowedFollow, false);
  delete process.env.DATA_DIR;
});
