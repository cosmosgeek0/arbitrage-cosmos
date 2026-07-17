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

test('Binance REST bounds unique active work without evicting single-flight identity', { concurrency: false }, async () => {
  const capacity = 32;
  const requests = [];
  globalThis.fetch = (input) => new Promise((resolve) => {
    requests.push({ input: String(input), resolve });
  });
  const rest = await import(`${modulePath('binance/rest')}?capacity=${Date.now()}`);
  const active = Array.from({ length: capacity }, (_, index) => (
    rest.fetchFundingHist(`R${index}USDT`, 10)
  ));
  await Promise.resolve();
  assert.equal(requests.length, capacity);

  const duplicate = rest.fetchFundingHist('R0USDT', 10);
  await Promise.resolve();
  assert.equal(requests.length, capacity, 'same-key work must join the retained active request');
  await assert.rejects(
    rest.fetchFundingHist('OVERFLOWUSDT', 10),
    /Binance REST capacity reached/,
  );
  assert.equal(requests.length, capacity, 'overflow must fail before fetch admission');

  requests[0].resolve(jsonResponse([{ fundingTime: 1_700_000_000_000, fundingRate: '0.0001' }]));
  const [first, joined] = await Promise.all([active[0], duplicate]);
  assert.deepEqual(joined, first);

  const admittedAfterSettlement = rest.fetchFundingHist('OVERFLOWUSDT', 10);
  await Promise.resolve();
  assert.equal(requests.length, capacity + 1, 'settlement must release one admission slot');
  for (const request of requests.slice(1)) {
    request.resolve(jsonResponse([{ fundingTime: 1_700_000_000_000, fundingRate: '0.0001' }]));
  }
  await Promise.all([...active.slice(1), admittedAfterSettlement]);
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

test('money flow bounds active walkers without evicting duplicate work', { concurrency: false }, async () => {
  const capacity = 4;
  const requests = [];
  globalThis.fetch = (input, init = {}) => new Promise((resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    requests.push({ input: String(input), resolve });
  });
  const moneyflow = await import(`${modulePath('binance/moneyflow')}?capacity=${Date.now()}`);
  const active = Array.from({ length: capacity }, (_, index) => (
    moneyflow.fetchMoneyFlow(`FLOW${index}USDT`, '15m')
  ));
  await Promise.resolve();
  assert.equal(requests.length, capacity);

  const duplicate = moneyflow.fetchMoneyFlow('FLOW0USDT', '15m');
  await Promise.resolve();
  assert.equal(requests.length, capacity, 'same-key caller must share the active walker');
  await assert.rejects(
    moneyflow.fetchMoneyFlow('FLOWOVERUSDT', '15m'),
    /money flow capacity reached/,
  );
  assert.equal(requests.length, capacity, 'overflow must fail before starting a walker');

  const completeWindow = () => jsonResponse([{
    p: '100', q: '2', T: Date.now() - 16 * 60_000, m: false,
  }]);
  requests[0].resolve(completeWindow());
  const [first, joined] = await Promise.all([active[0], duplicate]);
  assert.deepEqual(joined, first);

  const admittedAfterSettlement = moneyflow.fetchMoneyFlow('FLOWOVERUSDT', '15m');
  await Promise.resolve();
  assert.equal(requests.length, capacity + 1, 'settled walker must release one admission slot');
  for (const request of requests.slice(1)) request.resolve(completeWindow());
  await Promise.all([...active.slice(1), admittedAfterSettlement]);
});

test('money flow cancellation is subscriber-safe and abandons work only after the last caller', { concurrency: false }, async () => {
  const requests = [];
  globalThis.fetch = (input, init = {}) => new Promise((resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    requests.push({ input: String(input), resolve, signal: init.signal });
  });
  const moneyflow = await import(`${modulePath('binance/moneyflow')}?abort=${Date.now()}`);
  const firstController = new AbortController();
  const first = moneyflow.fetchMoneyFlow('SHAREDUSDT', '15m', firstController.signal);
  const survivor = moneyflow.fetchMoneyFlow('SHAREDUSDT', '15m');
  await Promise.resolve();
  assert.equal(requests.length, 1);

  firstController.abort();
  await assert.rejects(first, (error) => error?.name === 'AbortError');
  assert.equal(requests[0].signal.aborted, false, 'one departing subscriber must not abort shared work');
  requests[0].resolve(jsonResponse([{
    p: '100', q: '2', T: Date.now() - 16 * 60_000, m: false,
  }]));
  assert.equal((await survivor).symbol, 'SHAREDUSDT');

  const soleController = new AbortController();
  const sole = moneyflow.fetchMoneyFlow('ABANDONUSDT', '15m', soleController.signal);
  await Promise.resolve();
  assert.equal(requests.length, 2);
  soleController.abort();
  await assert.rejects(sole, (error) => error?.name === 'AbortError');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests[1].signal.aborted, true, 'last departing subscriber must abort upstream work');

  const retry = moneyflow.fetchMoneyFlow('ABANDONUSDT', '15m');
  await Promise.resolve();
  assert.equal(requests.length, 3, 'caller cancellation must not poison retry admission');
  requests[2].resolve(jsonResponse([{
    p: '100', q: '2', T: Date.now() - 16 * 60_000, m: false,
  }]));
  assert.equal((await retry).symbol, 'ABANDONUSDT');
});

test('money flow never reports stale cache as a successful refresh', { concurrency: false }, async () => {
  const originalNow = Date.now;
  let now = 1_700_000_000_000;
  let calls = 0;
  Date.now = () => now;
  try {
    globalThis.fetch = async () => {
      calls++;
      if (calls > 1) throw new Error('upstream unavailable');
      return jsonResponse([{ p: '100', q: '2', T: now - 16 * 60_000, m: false }]);
    };
    const moneyflow = await import(`${modulePath('binance/moneyflow')}?stale=${now}`);
    const first = await moneyflow.fetchMoneyFlow('STALEUSDT', '15m');
    assert.equal(first.fetchedAt, now);

    now += 46_000;
    await assert.rejects(moneyflow.fetchMoneyFlow('STALEUSDT', '15m'), /money flow unavailable/);
    assert.equal(calls, 2);
    await assert.rejects(moneyflow.fetchMoneyFlow('STALEUSDT', '15m'), /money flow unavailable/);
    assert.equal(calls, 2, 'negative-cache interval must remain an explicit failure');
  } finally {
    Date.now = originalNow;
  }
});

test('money flow reports call-cap truncation through coverage fields', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    const endTime = Number(new URL(String(input)).searchParams.get('endTime'));
    const row = { p: '100', q: '1', T: endTime - 1_000, m: false };
    return jsonResponse(Array.from({ length: 1_000 }, () => row));
  };
  const moneyflow = await import(`${modulePath('binance/moneyflow')}?coverage=${Date.now()}`);
  const flow = await moneyflow.fetchMoneyFlow('COVERAGEUSDT', '1d');
  assert.equal(calls, 60);
  assert.equal(flow.sampled, true);
  assert.equal(flow.coveredMs > 0, true);
  assert.equal(flow.coveredMs < flow.windowMs, true);
  assert.equal(Number.isFinite(flow.fetchedAt), true);
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

test('news context upstream policy rejects non-GET methods before fetch state and forces normalized GET', { concurrency: false }, async () => {
  const news = await import(`${modulePath('services/newsContext')}?get-only=${Date.now()}`);

  for (const method of ['POST', 'PUT', 'pOsT', '', ' ', 'GET ', null, 1]) {
    assert.throws(
      () => news.normalizeNewsContextRequestMethod(method),
      /News context upstream requests are GET-only/,
    );
  }
  assert.equal(news.normalizeNewsContextRequestMethod(undefined), 'GET');
  assert.equal(news.normalizeNewsContextRequestMethod('gEt'), 'GET');

  const source = await readFile(new URL('../src/services/newsContext.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /async function fetchBodyWithRetry[\s\S]*?\{\s*\/\/ Reject before URL\/cache\/single-flight[\s\S]*?normalizeNewsContextRequestMethod\([^;]+;\s*const url = validateFetchUrl/,
    'retry owner must enforce GET before URL, cache, and single-flight state',
  );
  assert.match(
    source,
    /async function fetchBodyOnce[\s\S]*?\{\s*const method = normalizeNewsContextRequestMethod\([^;]+;[\s\S]*?await fetch\(current, \{\s*\.\.\.init,\s*method,/,
    'the private fetch call must use only the normalized literal GET result',
  );
});
