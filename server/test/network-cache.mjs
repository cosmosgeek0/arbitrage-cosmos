import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const originalFetch = globalThis.fetch;
const sourceMode = process.env.NETWORK_TEST_SOURCE === '1';
const modulePath = (relative) => sourceMode ? `../src/${relative}.ts` : `../dist/${relative}.js`;
const CACHE_ENV_NAMES = Object.freeze([
  'DATA_DIR',
  'DATA_DIR_LOGICAL_LEASE_ROOT',
  'PROFILE_CACHE',
  'SKIP_DOTENV',
]);
const originalCacheEnvironment = Object.fromEntries(
  CACHE_ENV_NAMES.map((name) => [name, process.env[name]]),
);
const suiteTemp = await mkdtemp(path.join(os.tmpdir(), 'cosmos-network-cache-suite-'));
const suiteRoot = await realpath(suiteTemp);
const suiteDataDir = path.join(suiteRoot, 'data');
const suiteProfileCache = path.join(suiteDataDir, 'profiles.json');
await mkdir(suiteDataDir, { recursive: true, mode: 0o700 });
Object.assign(process.env, {
  DATA_DIR: suiteDataDir,
  DATA_DIR_LOGICAL_LEASE_ROOT: path.join(suiteRoot, 'logical-runtime'),
  PROFILE_CACHE: suiteProfileCache,
  SKIP_DOTENV: '1',
});

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

test.after(async () => {
  try {
    const environment = await import(modulePath('bootstrap/environment'));
    environment.DATA_DIR_LEASE.release();
  } finally {
    for (const name of CACHE_ENV_NAMES) {
      const original = originalCacheEnvironment[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    await rm(suiteRoot, { recursive: true, force: true });
  }
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

test('Markets generation abort fences late REST cache publication and next-generation single-flight', { concurrency: false }, async () => {
  const controlled = controlledJsonFetch({ settleOnAbort: false });
  globalThis.fetch = controlled.fetch;
  const rest = await import(`${modulePath('binance/rest')}?markets-generation=${Date.now()}`);
  const firstController = new AbortController();
  const secondController = new AbortController();
  const firstContext = Object.freeze({
    cacheScope: 'markets',
    generation: 1,
    signal: firstController.signal,
  });
  const secondContext = Object.freeze({
    cacheScope: 'markets',
    generation: 2,
    signal: secondController.signal,
  });

  const first = rest.fetchAllBookTickers('spot', firstContext);
  await flushMicrotasks();
  assert.equal(controlled.pending.length, 1);

  const second = rest.fetchAllBookTickers('spot', secondContext);
  await flushMicrotasks();
  assert.equal(
    controlled.pending.length,
    2,
    'the next Markets generation must not join prior-generation REST work',
  );

  firstController.abort(new Error('markets generation stopped'));
  assert.equal(controlled.pending[0].aborted, true);
  controlled.pending[0].resolve([{
    symbol: 'OLDUSDT',
    bidPrice: '1',
    bidQty: '2',
    askPrice: '1.1',
    askQty: '3',
  }]);
  await assert.rejects(first, /markets generation stopped/);

  controlled.pending[1].resolve([{
    symbol: 'NEWUSDT',
    bidPrice: '2',
    bidQty: '3',
    askPrice: '2.1',
    askQty: '4',
  }]);
  const current = await second;
  assert.deepEqual([...current.keys()], ['NEWUSDT']);

  const shared = rest.fetchAllBookTickers('spot');
  await flushMicrotasks();
  assert.equal(
    controlled.pending.length,
    3,
    'lifecycle-bound results must not publish into the reusable shared REST cache',
  );
  controlled.pending[2].resolve([{
    symbol: 'SHAREDUSDT',
    bidPrice: '3',
    bidQty: '4',
    askPrice: '3.1',
    askQty: '5',
  }]);
  assert.deepEqual([...(await shared).keys()], ['SHAREDUSDT']);
});

test('optional leaf sources boot OFF and reject or suppress work without dispatch', { concurrency: false }, async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('OFF source dispatched');
  };
  const nonce = Date.now();
  const [moneyflow, profile, news, icons] = await Promise.all([
    import(`${modulePath('binance/moneyflow')}?off=${nonce}`),
    import(`${modulePath('binance/profile')}?off=${nonce}`),
    import(`${modulePath('services/newsContext')}?off=${nonce}`),
    import(`${modulePath('binance/icons')}?off=${nonce}`),
  ]);

  assert.deepEqual(moneyflow.moneyFlowLifecycle(), {
    running: false,
    generation: 0,
    activeWalks: 0,
  });
  await assert.rejects(
    moneyflow.fetchMoneyFlow('OFFFLOWUSDT', '15m'),
    /money flow stopped/,
  );

  assert.equal(profile.profileSourceLifecycle().state, 'STOPPED');
  assert.equal(await profile.tokenProfile('OFFPROFILE'), null);
  assert.deepEqual({
    activeRequests: profile.profileSourceLifecycle().activeRequests,
    queuedRequests: profile.profileSourceLifecycle().queuedRequests,
    inFlightKeys: profile.profileSourceLifecycle().inFlightKeys,
  }, {
    activeRequests: 0,
    queuedRequests: 0,
    inFlightKeys: 0,
  });

  assert.equal(news.newsContextLifecycle().state, 'STOPPED');
  await assert.rejects(news.refreshNewsContextNow(), /news context source stopped/);
  assert.deepEqual({
    refreshing: news.newsContextLifecycle().refreshing,
    bodyInFlight: news.newsContextLifecycle().bodyInFlight,
  }, {
    refreshing: false,
    bodyInFlight: 0,
  });

  assert.equal(icons.iconSourceLifecycle().state, 'STOPPED');
  assert.deepEqual(icons.resolveIcons(['OFFICON']), {});
  assert.deepEqual({
    queued: icons.iconSourceLifecycle().queued,
    pending: icons.iconSourceLifecycle().pending,
    draining: icons.iconSourceLifecycle().draining,
    activeRequest: icons.iconSourceLifecycle().activeRequest,
  }, {
    queued: 0,
    pending: 0,
    draining: false,
    activeRequest: false,
  });
  assert.equal(calls, 0);
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
  moneyflow.startMoneyFlow();
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
  moneyflow.startMoneyFlow();
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
  moneyflow.startMoneyFlow();
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
    moneyflow.startMoneyFlow();
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
  moneyflow.startMoneyFlow();
  const flow = await moneyflow.fetchMoneyFlow('COVERAGEUSDT', '1d');
  assert.equal(calls, 60);
  assert.equal(flow.sampled, true);
  assert.equal(flow.coveredMs > 0, true);
  assert.equal(flow.coveredMs < flow.windowMs, true);
  assert.equal(Number.isFinite(flow.fetchedAt), true);
});

test('profile lookup single-flights misses and honors its negative cache', { concurrency: false }, async () => {
  await rm(suiteProfileCache, { force: true });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ coins: [] });
  };
  const profile = await import(`${modulePath('binance/profile')}?negative=${Date.now()}`);
  profile.startProfileSource();
  const base = 'ZZZNEGATIVECACHE';
  const [first, second] = await Promise.all([profile.tokenProfile(base), profile.tokenProfile(base)]);
  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(calls, 1);
  assert.equal(await profile.tokenProfile(base), null);
  assert.equal(calls, 1);
  await profile.flushProfileCache();
  const persisted = JSON.parse(await readFile(suiteProfileCache, 'utf8'));
  assert.equal(Object.keys(persisted).length, 1);
  assert.equal((await stat(suiteProfileCache)).size <= 16 * 1024 * 1024, true);
  await profile.stopProfileSource();
});

test('profile outbound admission is bounded, single-flight, paced FIFO work', { concurrency: false }, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 });
  await rm(suiteProfileCache, { force: true });
  const transport = controlledJsonFetch();
  globalThis.fetch = transport.fetch;
  let profile = null;
  t.after(async () => {
    if (profile) await profile.flushProfileCache();
  });

  profile = await import(`${modulePath('binance/profile')}?bounded-fifo`);
  profile.startProfileSource();
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
  await rm(suiteProfileCache, { force: true });
  const transport = controlledJsonFetch();
  globalThis.fetch = transport.fetch;
  let profile = null;
  t.after(async () => {
    if (profile) await profile.flushProfileCache();
  });

  profile = await import(`${modulePath('binance/profile')}?end-to-end-deadline`);
  profile.startProfileSource();
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
  await rm(suiteProfileCache, { force: true });
  const transport = controlledJsonFetch({ settleOnAbort: false });
  globalThis.fetch = transport.fetch;
  let profile = null;
  t.after(async () => {
    if (profile) await profile.flushProfileCache();
  });

  profile = await import(`${modulePath('binance/profile')}?retain-active-permit`);
  profile.startProfileSource();
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
  await rm(suiteProfileCache, { force: true });
  const staleTs = now - 60 * 60 * 1000 - 1;
  const freshTs = now - 1_000;
  await writeFile(suiteProfileCache, JSON.stringify({
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
  });

  profile = await import(`${modulePath('binance/profile')}?delivery-truth`);
  profile.startProfileSource();
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
  const persisted = JSON.parse(await readFile(suiteProfileCache, 'utf8'));
  assert.equal(persisted.STALECACHE.profileTs, staleTs);
  assert.equal(persisted.STALECACHE.profile.fetchedAt, staleTs);
});

test('news archive sanitizes retained strings and URLs and never follows a disallowed redirect', { concurrency: false }, async () => {
  await writeFile(path.join(suiteDataDir, 'news-archive.json'), JSON.stringify([{
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
  news.startNewsContext();
  const payload = await news.getNewsContext(false);
  assert.equal(payload.items[0].title.length, 320);
  assert.equal(payload.items[0].url, null);
  assert.notEqual(payload.items[0].timeLabel, 'stale');
  await news.refreshNewsContextNow();
  assert.equal(disallowedFollow, false);
  await news.stopNewsContext();
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
    /async function fetchBodyOnce[\s\S]*?\{\s*assertNewsContextRun\(run\);\s*const method = normalizeNewsContextRequestMethod\([^;]+;[\s\S]*?await fetch\(current, \{\s*\.\.\.init,\s*method,/,
    'the private fetch call must use only the normalized literal GET result',
  );
});
