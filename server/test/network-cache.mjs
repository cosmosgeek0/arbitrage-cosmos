import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

async function flushMicrotasks(rounds = 12) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function controlledJsonFetch({ settleOnAbort = true } = {}) {
  const calls = [];
  const pending = [];
  return {
    calls,
    pending,
    fetch(input, init = {}) {
      const url = new URL(String(input));
      calls.push(url);
      return new Promise((resolve, rejectPromise) => {
        const signal = init.signal;
        let settled = false;
        const onAbort = () => {
          if (settled) return;
          if (!settleOnAbort) return;
          settled = true;
          rejectPromise(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'));
        };
        const record = {
          url,
          get aborted() { return signal?.aborted === true; },
          resolve(value, responseInit = {}) {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            resolve(jsonResponse(value, responseInit));
          },
          reject(reason) {
            if (settled) return;
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            rejectPromise(reason);
          },
        };
        pending.push(record);
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
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

test('profile outbound admission is bounded, single-flight, paced FIFO work', { concurrency: false }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 });
  const temp = await mkdtemp(path.join(os.tmpdir(), 'cosmos-profile-queue-test-'));
  process.env.PROFILE_CACHE = path.join(temp, 'profiles.json');
  const transport = controlledJsonFetch();
  globalThis.fetch = transport.fetch;
  let profile = null;
  t.after(async () => {
    if (profile) await profile.flushProfileCache();
    delete process.env.PROFILE_CACHE;
    await rm(temp, { recursive: true, force: true });
  });

  profile = await import(`${modulePath('binance/profile')}?bounded-fifo`);
  const initial = profile.profileWarmStatus();
  const capacity = initial.outbound.queueCapacity;
  assert.equal(initial.outbound.activeCapacity, 1);
  assert.equal(capacity, 4);

  const bases = Array.from({ length: capacity + 2 }, (_, index) => `FIFO${String.fromCharCode(65 + index)}`);
  const requests = bases.map((base) => profile.tokenProfile(base));
  const sharedTransport = profile.tokenProfile(bases[0], { forceFull: true });
  await flushMicrotasks();

  assert.deepEqual(transport.calls.map((url) => url.searchParams.get('query')), [bases[0]]);
  assert.equal(transport.pending.length, 1);
  const saturated = profile.profileWarmStatus().outbound;
  assert.equal(saturated.activeRequests, 1);
  assert.equal(saturated.queueDepth, capacity);
  assert.equal(saturated.queueHighWatermark, capacity);
  assert.equal(saturated.inFlightKeys, capacity + 1);
  assert.equal(saturated.capacityRejected, 1);

  transport.pending[0].resolve({ coins: [] });
  await flushMicrotasks();
  t.mock.timers.tick(2_499);
  await flushMicrotasks();
  assert.equal(transport.calls.length, 1, 'pacing must not start the next FIFO entry early');
  t.mock.timers.tick(1);
  await flushMicrotasks();
  assert.equal(transport.calls[1].searchParams.get('query'), bases[1]);

  for (let index = 1; index <= capacity; index += 1) {
    transport.pending[index].resolve({ coins: [] });
    await flushMicrotasks();
    if (index < capacity) {
      t.mock.timers.tick(2_500);
      await flushMicrotasks();
      assert.equal(transport.calls[index + 1].searchParams.get('query'), bases[index + 1]);
    }
  }

  const results = await Promise.all([...requests, sharedTransport]);
  assert.equal(results.every((value) => value === null), true);
  const drained = profile.profileWarmStatus().outbound;
  assert.equal(drained.activeRequests, 0);
  assert.equal(drained.queueDepth, 0);
  assert.equal(drained.inFlightKeys, 0);

  const rejectedBase = bases[capacity + 1];
  const retry = profile.tokenProfile(rejectedBase);
  await flushMicrotasks();
  t.mock.timers.tick(2_500);
  await flushMicrotasks();
  assert.equal(transport.calls[capacity + 1].searchParams.get('query'), rejectedBase, 'local capacity rejection must not populate the negative cache');
  transport.pending[capacity + 1].resolve({ coins: [] });
  assert.equal(await retry, null);
});

test('profile deadline covers queue wait plus fetch and does not poison later admission', { concurrency: false }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_100_000_000 });
  const temp = await mkdtemp(path.join(os.tmpdir(), 'cosmos-profile-deadline-test-'));
  process.env.PROFILE_CACHE = path.join(temp, 'profiles.json');
  const transport = controlledJsonFetch();
  globalThis.fetch = transport.fetch;
  let profile = null;
  t.after(async () => {
    if (profile) await profile.flushProfileCache();
    delete process.env.PROFILE_CACHE;
    await rm(temp, { recursive: true, force: true });
  });

  profile = await import(`${modulePath('binance/profile')}?end-to-end-deadline`);
  const active = profile.tokenProfile('DEADLINEACTIVE');
  const queued = profile.tokenProfile('DEADLINEQUEUED');
  await flushMicrotasks();
  assert.deepEqual(transport.calls.map((url) => url.searchParams.get('query')), ['DEADLINEACTIVE']);

  t.mock.timers.tick(12_000);
  await flushMicrotasks();
  assert.equal(transport.pending[0].aborted, true);
  assert.deepEqual(await Promise.all([active, queued]), [null, null]);
  const expired = profile.profileWarmStatus().outbound;
  assert.equal(expired.deadlineExceeded, 2);
  assert.equal(expired.activeRequests, 0);
  assert.equal(expired.queueDepth, 0);
  assert.equal(expired.inFlightKeys, 0);
  assert.deepEqual(transport.calls.map((url) => url.searchParams.get('query')), ['DEADLINEACTIVE'], 'expired queued work must never fetch');

  const retry = profile.tokenProfile('DEADLINEQUEUED');
  await flushMicrotasks();
  assert.equal(transport.calls[1].searchParams.get('query'), 'DEADLINEQUEUED', 'local deadline must not populate the negative cache');
  transport.pending[1].resolve({ coins: [] });
  assert.equal(await retry, null);
});

test('profile retains its active permit until a timed-out transport actually settles', { concurrency: false }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_150_000_000 });
  const temp = await mkdtemp(path.join(os.tmpdir(), 'cosmos-profile-permit-test-'));
  process.env.PROFILE_CACHE = path.join(temp, 'profiles.json');
  const transport = controlledJsonFetch({ settleOnAbort: false });
  globalThis.fetch = transport.fetch;
  let profile = null;
  t.after(async () => {
    if (profile) await profile.flushProfileCache();
    delete process.env.PROFILE_CACHE;
    await rm(temp, { recursive: true, force: true });
  });

  profile = await import(`${modulePath('binance/profile')}?retain-active-permit`);
  const active = profile.tokenProfile('PERMITACTIVE');
  await flushMicrotasks();
  t.mock.timers.tick(1_000);
  const queued = profile.tokenProfile('PERMITQUEUED');
  await flushMicrotasks();

  t.mock.timers.tick(11_000);
  await flushMicrotasks();
  assert.equal(await active, null);
  assert.equal(transport.pending[0].aborted, true);
  assert.deepEqual(transport.calls.map((url) => url.searchParams.get('query')), ['PERMITACTIVE']);
  const waiting = profile.profileWarmStatus().outbound;
  assert.equal(waiting.activeRequests, 1, 'timed-out transport retains the sole active permit until settlement');
  assert.equal(waiting.queueDepth, 1);
  assert.equal(waiting.inFlightKeys, 2, 'timed-out transport retains single-flight identity until settlement');

  transport.pending[0].reject(new Error('delayed abort settlement'));
  await flushMicrotasks();
  assert.deepEqual(transport.calls.map((url) => url.searchParams.get('query')), ['PERMITACTIVE', 'PERMITQUEUED']);
  transport.pending[1].resolve({ coins: [] });
  assert.equal(await queued, null);
  const drained = profile.profileWarmStatus().outbound;
  assert.equal(drained.activeRequests, 0);
  assert.equal(drained.queueDepth, 0);
  assert.equal(drained.inFlightKeys, 0);
});

test('profile cache delivery reports stale fallback and lite truncation without restamping evidence', { concurrency: false }, async (t) => {
  const now = 1_700_200_000_000;
  t.mock.timers.enable({ apis: ['Date'], now });
  const temp = await mkdtemp(path.join(os.tmpdir(), 'cosmos-profile-truth-test-'));
  process.env.PROFILE_CACHE = path.join(temp, 'profiles.json');
  const staleTs = now - 60 * 60 * 1000 - 1;
  const freshTs = now - 1_000;
  await writeFile(process.env.PROFILE_CACHE, JSON.stringify({
    STALECACHE: {
      id: 'stale-cache', idTs: staleTs, profileTs: staleTs,
      profile: { id: 'stale-cache', name: 'Stale Cache', symbol: 'STALECACHE', categories: [], platforms: [], full: true, fetchedAt: staleTs },
    },
    LITECACHE: {
      id: 'lite-cache', idTs: freshTs, profileTs: freshTs,
      profile: { id: 'lite-cache', name: 'Lite Cache', symbol: 'LITECACHE', categories: [], platforms: [], full: false, fetchedAt: freshTs },
    },
  }));
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ error: 'unavailable' }, { status: 503 });
  };
  let profile = null;
  t.after(async () => {
    if (profile) await profile.flushProfileCache();
    delete process.env.PROFILE_CACHE;
    await rm(temp, { recursive: true, force: true });
  });

  profile = await import(`${modulePath('binance/profile')}?delivery-truth`);
  const stale = await profile.tokenProfile('STALECACHE');
  assert.equal(stale.fetchedAt, staleTs);
  assert.deepEqual(stale.delivery, {
    source: 'CACHE',
    freshness: 'STALE',
    ageMs: now - staleTs,
    completeness: 'FULL_ENDPOINT',
    refreshState: 'FAILED',
    refreshErrorCode: 'TOKEN_PROFILE_SOURCE_UNAVAILABLE',
  });

  const lite = await profile.tokenProfile('LITECACHE');
  assert.equal(lite.fetchedAt, freshTs);
  assert.deepEqual(lite.delivery, {
    source: 'CACHE',
    freshness: 'FRESH',
    ageMs: now - freshTs,
    completeness: 'TRUNCATED_LITE',
    refreshState: 'NOT_REQUIRED',
    refreshErrorCode: null,
  });
  assert.equal(calls, 1);
  const status = profile.profileWarmStatus();
  assert.deepEqual(status.cacheTruth, {
    freshProfiles: 1,
    staleProfiles: 1,
    unknownFreshnessProfiles: 0,
    truncatedLiteProfiles: 1,
  });
  const persisted = JSON.parse(await readFile(process.env.PROFILE_CACHE, 'utf8'));
  assert.equal(persisted.STALECACHE.profileTs, staleTs);
  assert.equal(persisted.STALECACHE.profile.fetchedAt, staleTs);
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
