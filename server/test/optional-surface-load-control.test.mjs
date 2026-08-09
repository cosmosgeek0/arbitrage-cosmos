import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  iconSourceLifecycle,
  startIconSource,
  stopIconSource,
} from '../src/binance/icons.ts';
import {
  profileSourceLifecycle,
  startProfileSource,
  stopProfileSource,
} from '../src/binance/profile.ts';
import {
  moneyFlowLifecycle,
  startMoneyFlow,
  stopMoneyFlow,
} from '../src/binance/moneyflow.ts';
import { fetchDepth } from '../src/binance/rest.ts';
import {
  OPTIONAL_SURFACE_IDS,
  OptionalSurfaceControl,
  OptionalSurfaceOffError,
} from '../src/services/optionalSurfaceControl.ts';
import { createSourceLogoSource } from '../src/services/sourceLogo.ts';
import {
  newsContextStatus,
} from '../src/services/newsContext.ts';

const [indexSource, volumeRuntimeSource, bookStreamSource, iconResolverSource, restSource] = await Promise.all([
  readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/volumeRuntime.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/bookStream.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/binance/icons.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/binance/rest.ts', import.meta.url), 'utf8'),
]);

function sourceBetween(start, end) {
  const startAt = indexSource.indexOf(start);
  assert.notEqual(startAt, -1, `missing source boundary: ${start}`);
  const endAt = indexSource.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing source boundary: ${end}`);
  return indexSource.slice(startAt, endAt);
}

function routeMountIndex(pathname) {
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return indexSource.search(new RegExp(`app\\.(?:get|post|put|delete|patch)\\('${escaped}'`));
}

function counters() {
  return Object.fromEntries(OPTIONAL_SURFACE_IDS.map((id) => [id, {
    lifecycleStarts: 0,
    lifecycleStops: 0,
    workStarted: 0,
    workActive: 0,
    workCompleted: 0,
    workAborted: 0,
    startContexts: [],
    stopContexts: [],
  }]));
}

function harness() {
  const observed = counters();
  const runtimes = Object.fromEntries(OPTIONAL_SURFACE_IDS.map((id) => [id, {
    start(context) {
      observed[id].lifecycleStarts += 1;
      observed[id].startContexts.push(context);
    },
    stop(context) {
      observed[id].lifecycleStops += 1;
      observed[id].stopContexts.push(context);
    },
  }]));

  return {
    control: new OptionalSurfaceControl(runtimes),
    observed,
  };
}

function beginWork(control, observed, id) {
  const lease = control.acquire(id);
  const counter = observed[id];
  counter.workStarted += 1;
  counter.workActive += 1;
  let settled = false;
  const settle = (aborted) => {
    if (settled) return;
    settled = true;
    counter.workActive -= 1;
    if (aborted) counter.workAborted += 1;
    else counter.workCompleted += 1;
  };
  lease.signal.addEventListener('abort', () => settle(true), { once: true });

  return Object.freeze({
    signal: lease.signal,
    release() {
      settle(false);
      lease.release();
    },
  });
}

function expectedBootSnapshot(id) {
  return {
    id,
    desiredState: 'OFF',
    phase: 'OFF',
    generation: 0,
    admissionOpen: false,
    inFlight: 0,
    failureCode: null,
  };
}

test('all optional surfaces boot OFF and refuse admission before backend work', async () => {
  const { control, observed } = harness();

  const snapshots = control.snapshots();
  assert.equal(Object.isFrozen(snapshots), true);
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.id),
    ['news', 'calendar', 'logs', 'token', 'markets'],
  );

  for (const snapshot of snapshots) {
    assert.equal(Object.isFrozen(snapshot), true);
    assert.deepEqual(snapshot, expectedBootSnapshot(snapshot.id));
  }

  for (const id of OPTIONAL_SURFACE_IDS) {
    await assert.rejects(
      control.withAdmission(id, async () => {
        observed[id].workStarted += 1;
      }),
      (error) => error instanceof OptionalSurfaceOffError
        && error.code === 'OPTIONAL_SURFACE_OFF'
        && error.surface === id,
      `${id} must reject before work starts`,
    );
  }

  await control.stopAll();

  for (const id of OPTIONAL_SURFACE_IDS) {
    assert.deepEqual(control.snapshot(id), expectedBootSnapshot(id));
    assert.deepEqual(observed[id], {
      lifecycleStarts: 0,
      lifecycleStops: 0,
      workStarted: 0,
      workActive: 0,
      workCompleted: 0,
      workAborted: 0,
      startContexts: [],
      stopContexts: [],
    });
  }
});

test('one ON surface is isolated and OFF closes admission, aborts, and drains before acknowledgement', async () => {
  const { control, observed } = harness();

  const enabled = await control.setEnabled('markets', true);
  assert.equal(enabled.status, 'APPLIED');
  assert.equal(Object.isFrozen(enabled.snapshot), true);
  assert.deepEqual(enabled.snapshot, {
    id: 'markets',
    desiredState: 'ON',
    phase: 'ON',
    generation: 1,
    admissionOpen: true,
    inFlight: 0,
    failureCode: null,
  });
  assert.equal(observed.markets.lifecycleStarts, 1);
  assert.equal(observed.markets.workStarted, 0, 'enabling admission must not start backend work');
  assert.deepEqual(
    observed.markets.startContexts.map(({ id, generation, signal }) => ({
      id,
      generation,
      aborted: signal.aborted,
    })),
    [{ id: 'markets', generation: 1, aborted: false }],
  );

  for (const id of OPTIONAL_SURFACE_IDS) {
    if (id === 'markets') continue;
    assert.deepEqual(control.snapshot(id), expectedBootSnapshot(id));
    assert.equal(observed[id].lifecycleStarts, 0);
    assert.equal(observed[id].lifecycleStops, 0);
  }

  const work = beginWork(control, observed, 'markets');
  assert.notEqual(work, null);
  assert.equal(work.signal.aborted, false);
  assert.equal(control.snapshot('markets').inFlight, 1);
  assert.equal(observed.markets.workActive, 1);

  const disabling = control.setEnabled('markets', false);
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.deepEqual(control.snapshot('markets'), {
    id: 'markets',
    desiredState: 'OFF',
    phase: 'DRAINING',
    generation: 2,
    admissionOpen: false,
    inFlight: 1,
    failureCode: null,
  });
  assert.equal(work.signal.aborted, true, 'OFF aborts the admitted generation synchronously');
  assert.equal(observed.markets.workActive, 0);
  assert.equal(observed.markets.workAborted, 1);
  assert.throws(
    () => beginWork(control, observed, 'markets'),
    (error) => error instanceof OptionalSurfaceOffError
      && error.code === 'OPTIONAL_SURFACE_OFF'
      && error.surface === 'markets',
    'DRAINING refuses new work',
  );
  assert.equal(observed.markets.workStarted, 1, 'refused work never reaches the backend counter');
  assert.deepEqual(
    observed.markets.stopContexts.map(({ id, generation, signal }) => ({
      id,
      generation,
      aborted: signal.aborted,
    })),
    [{ id: 'markets', generation: 2, aborted: true }],
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observed.markets.lifecycleStops, 1);
  let disabledSettled = false;
  void disabling.then(() => {
    disabledSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disabledSettled, false, 'OFF acknowledgement waits for the admitted lease');

  work.release();
  const disabled = await disabling;
  assert.equal(disabled.status, 'APPLIED');
  assert.deepEqual(disabled.snapshot, {
    id: 'markets',
    desiredState: 'OFF',
    phase: 'OFF',
    generation: 2,
    admissionOpen: false,
    inFlight: 0,
    failureCode: null,
  });

  const repeatedOff = await control.setEnabled('markets', false);
  assert.equal(repeatedOff.status, 'NOOP');
  assert.equal(repeatedOff.snapshot.generation, 2);
  assert.equal(observed.markets.lifecycleStops, 1, 'repeat OFF cannot replay teardown');

  for (const id of OPTIONAL_SURFACE_IDS) {
    if (id === 'markets') continue;
    const started = await control.setEnabled(id, true);
    assert.equal(started.status, 'APPLIED');
    assert.equal(observed[id].workStarted, 0, `${id} enable remains zero-work until admitted demand`);
    const stopped = await control.setEnabled(id, false);
    assert.equal(stopped.status, 'APPLIED');
  }

  for (const id of OPTIONAL_SURFACE_IDS) {
    const snapshot = control.snapshot(id);
    assert.equal(snapshot.desiredState, 'OFF');
    assert.equal(snapshot.phase, 'OFF');
    assert.equal(snapshot.admissionOpen, false);
    assert.equal(snapshot.inFlight, 0);
    assert.equal(snapshot.failureCode, null);
    assert.equal(observed[id].workActive, 0);
    assert.equal(observed[id].lifecycleStarts, 1);
    assert.equal(observed[id].lifecycleStops, 1);
    if (id !== 'markets') {
      assert.equal(observed[id].workStarted, 0);
      assert.equal(observed[id].workCompleted, 0);
      assert.equal(observed[id].workAborted, 0);
    }
  }
});

test('News logo provider work is zero at default OFF and aborts without cache publication on OFF', async () => {
  const { control } = harness();
  let providerCalls = 0;
  let providerStarted;
  const started = new Promise((resolve) => {
    providerStarted = resolve;
  });
  const source = createSourceLogoSource({
    fetchImpl: (_url, init) => {
      providerCalls += 1;
      providerStarted();
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        const abort = () => reject(signal?.reason ?? new DOMException('aborted', 'AbortError'));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
    },
  });

  assert.deepEqual(source.snapshot(), {
    providerCalls: 0,
    inFlight: 0,
    cached: 0,
    failures: 0,
  });
  assert.equal(providerCalls, 0);

  await control.setEnabled('news', true);
  const lease = control.acquire('news');
  const lifecycle = {
    cacheScope: 'news',
    generation: lease.generation,
    signal: lease.signal,
  };
  const work = source.load('example.com', 64, lifecycle);
  await started;
  assert.equal(providerCalls, 1);

  const disabling = control.setEnabled('news', false);
  await assert.rejects(
    work,
    (error) => error instanceof OptionalSurfaceOffError && error.surface === 'news',
  );
  lease.release();
  const disabled = await disabling;

  assert.equal(disabled.snapshot.phase, 'OFF');
  assert.deepEqual(source.snapshot(), {
    providerCalls: 1,
    inFlight: 0,
    cached: 0,
    failures: 0,
  });
});

test('News logo positive cache is isolated across lifecycle generations', async () => {
  let providerCalls = 0;
  const source = createSourceLogoSource({
    fetchImpl: async () => {
      providerCalls += 1;
      return new Response(Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, providerCalls,
      ]), { status: 200 });
    },
  });
  const firstLifecycle = {
    cacheScope: 'news',
    generation: 1,
    signal: new AbortController().signal,
  };
  const secondLifecycle = {
    cacheScope: 'news',
    generation: 2,
    signal: new AbortController().signal,
  };

  const first = await source.load('example.com', 64, firstLifecycle);
  assert.equal(first.body.at(-1), 1);
  assert.equal(source.cached('example.com', 64, firstLifecycle)?.body.at(-1), 1);
  assert.equal(source.cached('example.com', 64, secondLifecycle), null);

  const second = await source.load('example.com', 64, secondLifecycle);
  assert.equal(second.body.at(-1), 2);
  assert.equal(providerCalls, 2);
  assert.deepEqual(source.snapshot(), {
    providerCalls: 2,
    inFlight: 0,
    cached: 2,
    failures: 0,
  });
});

test('News logo failure cache is isolated across lifecycle generations', async () => {
  let providerCalls = 0;
  const source = createSourceLogoSource({
    fetchImpl: async () => {
      providerCalls += 1;
      if (providerCalls === 1) throw new Error('generation-one source failure');
      return new Response(Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, providerCalls,
      ]), { status: 200 });
    },
  });
  const firstLifecycle = {
    cacheScope: 'news',
    generation: 1,
    signal: new AbortController().signal,
  };
  const secondLifecycle = {
    cacheScope: 'news',
    generation: 2,
    signal: new AbortController().signal,
  };

  await assert.rejects(
    source.load('example.com', 64, firstLifecycle),
    /generation-one source failure/,
  );
  assert.equal(source.snapshot().failures, 1);

  const second = await source.load('example.com', 64, secondLifecycle);
  assert.equal(second.body.at(-1), 2);
  assert.equal(providerCalls, 2);
  assert.deepEqual(source.snapshot(), {
    providerCalls: 2,
    inFlight: 0,
    cached: 1,
    failures: 1,
  });
});

test('Token REST work aborts on OFF and lifecycle caches never cross generations or seed retained core', async (t) => {
  const { control } = harness();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  let providerStarted;
  const started = new Promise((resolve) => {
    providerStarted = resolve;
  });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (_url, init) => {
    providerCalls += 1;
    providerStarted();
    const signal = init?.signal;
    return new Promise((_resolve, reject) => {
      const abort = () => reject(signal?.reason ?? new DOMException('aborted', 'AbortError'));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  };

  await control.setEnabled('token', true);
  const firstLease = control.acquire('token');
  const firstLifecycle = {
    cacheScope: 'token',
    generation: firstLease.generation,
    signal: firstLease.signal,
  };
  const firstRead = fetchDepth('OFFPROOFUSDT', 20, firstLifecycle);
  await started;
  assert.equal(providerCalls, 1);

  const firstDisable = control.setEnabled('token', false);
  await assert.rejects(
    firstRead,
    (error) => error instanceof OptionalSurfaceOffError && error.surface === 'token',
  );
  firstLease.release();
  await firstDisable;

  const depthPayload = {
    bids: [['10', '2']],
    asks: [['11', '3']],
  };
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(JSON.stringify(depthPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await control.setEnabled('token', true);
  const secondLease = control.acquire('token');
  const secondLifecycle = {
    cacheScope: 'token',
    generation: secondLease.generation,
    signal: secondLease.signal,
  };
  const depth = await fetchDepth('OFFPROOFUSDT', 20, secondLifecycle);
  assert.equal(providerCalls, 2, 'the aborted generation must not publish a reusable cache entry');
  assert.deepEqual(depth, {
    bids: [{ price: 10, qty: 2 }],
    asks: [{ price: 11, qty: 3 }],
  });

  secondLease.release();
  const secondDisabled = await control.setEnabled('token', false);
  assert.equal(secondDisabled.snapshot.phase, 'OFF');
  assert.equal(secondDisabled.snapshot.inFlight, 0);

  await control.setEnabled('token', true);
  const thirdLease = control.acquire('token');
  const thirdLifecycle = {
    cacheScope: 'token',
    generation: thirdLease.generation,
    signal: thirdLease.signal,
  };
  await fetchDepth('OFFPROOFUSDT', 20, thirdLifecycle);
  assert.equal(providerCalls, 3, 'a successful prior generation must not seed a later ON generation');
  thirdLease.release();
  await control.setEnabled('token', false);

  await fetchDepth('OFFPROOFUSDT', 20);
  assert.equal(providerCalls, 4, 'optional Token data must not seed the retained core cache namespace');
});

test('GET and PUT wire contracts are mounted behind operator admission', () => {
  const operatorAdmissionAt = indexSource.indexOf("app.use('/api', operatorAccess.middleware())");
  const getMountAt = indexSource.indexOf("app.get('/api/optional-surfaces',");
  const putMountAt = indexSource.indexOf("app.put('/api/optional-surfaces/:surface',");
  const surfaceAdmissionAt = indexSource.indexOf("app.use('/api', (req, res, next) =>");
  assert.ok(operatorAdmissionAt >= 0);
  assert.ok(operatorAdmissionAt < getMountAt);
  assert.ok(getMountAt < putMountAt);
  assert.ok(putMountAt < surfaceAdmissionAt);

  const getRoute = sourceBetween(
    "app.get('/api/optional-surfaces',",
    "app.put('/api/optional-surfaces/:surface',",
  );
  const putRoute = sourceBetween(
    "app.put('/api/optional-surfaces/:surface',",
    'function optionalSurfaceForRequest(',
  );

  assert.match(getRoute, /res\.json\(\{ surfaces: optionalSurfaceControl\.snapshots\(\) \}\)/);
  assert.match(putRoute, /isOptionalSurfaceId\(surface\)/);
  assert.match(putRoute, /Object\.keys\(body\)\.length !== 1/);
  assert.match(putRoute, /typeof body\.enabled !== 'boolean'/);
  assert.match(
    putRoute,
    /const result = await optionalSurfaceControl\.setEnabled\(surface, body\.enabled\)/,
  );
  assert.match(putRoute, /\.json\(result\)/);
});

test('every mapped optional route crosses admission before handler work while core markets stays retained', () => {
  const routeMapping = sourceBetween(
    'function optionalSurfaceForRequest(',
    "app.use('/api', (req, res, next) =>",
  );
  const admissionMiddleware = sourceBetween(
    "app.use('/api', (req, res, next) =>",
    '// Ambient bearer material cannot widen Phase 2 authority.',
  );
  const admissionMountAt = indexSource.indexOf("app.use('/api', (req, res, next) =>");

  assert.match(routeMapping, /pathname === '\/api\/events'.*return 'logs'/s);
  assert.match(routeMapping, /pathname === '\/api\/calendar'.*return 'calendar'/s);
  assert.match(routeMapping, /pathname === '\/api\/news'.*return 'news'/s);
  assert.match(routeMapping, /pathname === '\/api\/markets\/enrichment'\) return 'markets'/);
  assert.match(routeMapping, /pathname\.startsWith\('\/api\/token\/'\).*return 'token'/s);
  assert.match(indexSource, /function canonicalOptionalSurfacePath\(pathname: string\): string \{/);
  assert.match(indexSource, /pathname\.toLowerCase\(\)\.replace\(\/\\\/\+\$\/u, ''\)/);
  assert.match(admissionMiddleware, /canonicalOptionalSurfacePath\(`\/api\$\{req\.path === '\/' \? '' : req\.path\}`\)/);
  assert.match(admissionMiddleware, /optionalSurfaceControl\.acquire\(surface\)/);
  assert.match(admissionMiddleware, /res\.status\(503\)\.json/);
  assert.ok(
    admissionMiddleware.indexOf('optionalSurfaceControl.acquire(surface)')
      < admissionMiddleware.lastIndexOf('next();'),
    'admission must be acquired before the admitted request advances to its handler',
  );

  const exactOptionalPaths = [
    '/api/events',
    '/api/events/count',
    '/api/calendar',
    '/api/calendar/refresh',
    '/api/news',
    '/api/news/refresh',
    '/api/news-context',
    '/api/news-context/refresh',
    '/api/news-stream',
    '/api/source-logo',
    '/api/markets/enrichment',
    '/api/intelligence/token',
    '/api/market/detail',
    '/api/market/quote',
    '/api/market/depth',
    '/api/market/trades',
    '/api/klines',
    '/api/candles',
    '/api/funding/history',
    '/api/futures/telemetry',
    '/api/futures/funding-hist',
    '/api/futures/liquidations',
    '/api/futures/liquidations/stats',
    '/api/futures/oi-hist',
    '/api/futures/basis-hist',
    '/api/symbol/context',
  ];
  for (const pathname of exactOptionalPaths) {
    assert.ok(routeMapping.includes(`'${pathname}'`), `${pathname} must have an optional owner`);
    assert.ok(
      routeMountIndex(pathname) > admissionMountAt,
      `${pathname} handler must mount after optional admission`,
    );
  }

  const tokenRouteMounts = [...indexSource.matchAll(
    /app\.(?:get|post|put|delete|patch)\('(\/api\/token\/[^']+)'/g,
  )];
  assert.ok(tokenRouteMounts.length > 0);
  for (const mount of tokenRouteMounts) {
    assert.ok((mount.index ?? -1) > admissionMountAt, `${mount[1]} must mount after optional admission`);
  }

  assert.doesNotMatch(routeMapping, /pathname === '\/api\/markets'\s*\)/);
  const coreMarketsRoute = sourceBetween(
    "app.get('/api/markets',",
    "app.get('/api/markets/enrichment',",
  );
  assert.doesNotMatch(
    coreMarketsRoute,
    /optionalSurface|readMarketEnrichmentSnapshot|marketSources/,
  );
});

test('News logo and Token public-provider routes carry the admitted generation signal', () => {
  const lifecycleHelpers = sourceBetween(
    'type OptionalSurfaceRequestContext',
    '// Ambient bearer material cannot widen Phase 2 authority.',
  );
  assert.match(lifecycleHelpers, /context\.signal\.aborted/);
  assert.match(lifecycleHelpers, /snapshot\.generation !== context\.generation/);
  assert.match(lifecycleHelpers, /cacheScope: context\.id/);
  assert.ok(
    (restSource.match(/lifecycleCacheKey\(/g)?.length ?? 0) >= 11,
    'every Token REST cache must isolate lifecycle generations from retained core callers',
  );

  assert.match(indexSource, /sourceLogoSource\.cached\(domain, size, lifecycle\)/);
  assert.match(indexSource, /sourceLogoSource\.load\(domain, size, lifecycle\)/);
  assert.match(indexSource, /fetchMoneyFlow\(symbol, window, context\.signal\)/);
  assert.equal(
    indexSource.match(/fetchBookTicker\(symbol, lifecycle\)/g)?.length,
    2,
    'Token detail and quote must both propagate lifecycle cancellation',
  );
  for (const call of [
    'fetchFundingHist(symbol, limit, lifecycle)',
    'fetchOiHist(symbol, period, limit, lifecycle)',
    'fetchBasisHist(symbol, period, limit, lifecycle)',
    'fetchKlines(symbol, interval, limit, market, field, lifecycle)',
    'fetchKlineCandles(symbol, interval, limit, market, lifecycle)',
    'fetchDepth(symbol, 20, lifecycle)',
    'fetchTrades(symbol, 30, lifecycle)',
    'fetchFundingHistory(symbol, 120, lifecycle)',
    'fetchFuturesTelemetry(symbol, period, limit, lifecycle)',
  ]) {
    assert.ok(indexSource.includes(call), `${call} must carry Token lifecycle cancellation`);
  }
});

test('icon requests require one explicit Token-or-Markets owner before admission or queueing', () => {
  const ownerParser = sourceBetween(
    "type IconSurfaceOwner = 'token' | 'markets';",
    "app.use('/api', (req, res, next) =>",
  );
  const admissionMiddleware = sourceBetween(
    "app.use('/api', (req, res, next) =>",
    '// Ambient bearer material cannot widen Phase 2 authority.',
  );
  const iconRoute = sourceBetween(
    "app.get('/api/icons',",
    'async function readBoundedBody(',
  );

  assert.match(
    ownerParser,
    /value === 'token' \|\| value === 'markets' \? value : null/,
    'missing, repeated, or unknown owner values must fail closed',
  );
  assert.match(
    admissionMiddleware,
    /pathname === '\/api\/icons'[\s\S]*?iconSurfaceOwner\(req\.query\.owner\)/,
    'icon admission must derive one owner from the request',
  );
  const ownerAt = admissionMiddleware.indexOf('const requestedIconOwner');
  const invalidAt = admissionMiddleware.indexOf(
    "if (pathname === '/api/icons' && requestedIconOwner === null)",
    ownerAt,
  );
  const invalidResponseAt = admissionMiddleware.indexOf("code: 'INVALID_ICON_OWNER'", invalidAt);
  const invalidReturnAt = admissionMiddleware.indexOf('return;', invalidResponseAt);
  const candidateAt = admissionMiddleware.indexOf(
    'const candidateSurfaces: readonly OptionalSurfaceId[]',
    invalidReturnAt,
  );
  const exactOwnerAt = admissionMiddleware.indexOf('? [requestedIconOwner]', candidateAt);
  const acquireAt = admissionMiddleware.indexOf('optionalSurfaceControl.acquire(surface)', exactOwnerAt);
  assert.ok(ownerAt >= 0);
  assert.ok(invalidAt > ownerAt);
  assert.ok(invalidResponseAt > invalidAt);
  assert.ok(invalidReturnAt > invalidResponseAt, 'missing or invalid owners stop in middleware');
  assert.ok(candidateAt > invalidReturnAt, 'invalid owners cannot reach candidate construction');
  assert.ok(exactOwnerAt > candidateAt, 'admission must target only the requested owner');
  assert.ok(acquireAt > exactOwnerAt, 'the requested owner is fixed before lease acquisition');
  assert.doesNotMatch(
    admissionMiddleware,
    /\['token', 'markets'\]/,
    'an OFF requested owner cannot fall through to the other surface',
  );
  assert.match(admissionMiddleware, /res\.locals\.optionalSurfaceRelease = release/);

  const routeOwnerAt = iconRoute.indexOf('const owner = iconSurfaceOwner(req.query.owner)');
  const routeAdmissionAt = iconRoute.indexOf('const admission = res.locals.optionalSurface', routeOwnerAt);
  const routeRejectAt = iconRoute.indexOf(
    'if (owner === null || admission?.id !== owner)',
    routeAdmissionAt,
  );
  const routeReturnAt = iconRoute.indexOf('return;', routeRejectAt);
  const basesAt = iconRoute.indexOf('const bases =', routeReturnAt);
  const resolveAt = iconRoute.indexOf('resolveIcons(bases)', basesAt);
  assert.ok(routeOwnerAt >= 0);
  assert.ok(routeAdmissionAt > routeOwnerAt);
  assert.ok(routeRejectAt > routeAdmissionAt, 'the handler rechecks the exact admitted owner');
  assert.ok(routeReturnAt > routeRejectAt, 'an owner mismatch returns before icon work');
  assert.ok(basesAt > routeReturnAt);
  assert.ok(resolveAt > basesAt, 'only a validated, admitted owner may queue icon resolution');
  assert.match(
    iconRoute,
    /runAsync\(res, async \(\) => \{[\s\S]*?resolveIcons\(bases\)/,
  );
});

test('stopping either shared icon owner awaits a global clear before restarting only for remaining owners', () => {
  const sharedLifecycle = sourceBetween(
    'const iconSurfaceOwners =',
    "optionalSurfaceControl.registerRuntime('news',",
  );
  const startSharedAt = sharedLifecycle.indexOf('function startSharedIconSource(');
  const stopSharedAt = sharedLifecycle.indexOf('function stopSharedIconSource(', startSharedAt);
  const startShared = sharedLifecycle.slice(startSharedAt, stopSharedAt);
  const stopShared = sharedLifecycle.slice(stopSharedAt);

  assert.match(startShared, /iconSurfaceOwners\.add\(owner\)/);
  assert.match(
    startShared,
    /if \(iconSurfaceOwners\.size > 0\) startIconSource\(\)/,
    'the global source starts only when at least one owner remains registered',
  );

  const removeOwnerAt = stopShared.indexOf('iconSurfaceOwners.delete(owner)');
  const otherOwnerAt = stopShared.indexOf(
    "const otherOwner: IconSurfaceOwner = owner === 'token' ? 'markets' : 'token'",
    removeOwnerAt,
  );
  const transitionAt = stopShared.indexOf('const transition = iconSurfaceTransition', otherOwnerAt);
  const stopAt = stopShared.indexOf('await stopIconSource()', transitionAt);
  const remainingAt = stopShared.indexOf('if (iconSurfaceOwners.has(otherOwner))', stopAt);
  const restartAt = stopShared.indexOf('startIconSource()', remainingAt);
  const publishAt = stopShared.indexOf('iconSurfaceTransition = transition', restartAt);
  const returnAt = stopShared.indexOf('return transition', publishAt);
  assert.ok(removeOwnerAt >= 0);
  assert.ok(otherOwnerAt > removeOwnerAt, 'restart authority is limited to the opposite owner');
  assert.ok(transitionAt > otherOwnerAt, 'owner removal is visible before serialized teardown');
  assert.ok(stopAt > transitionAt, 'every owner OFF performs the global stop');
  assert.ok(remainingAt > stopAt, 'remaining ownership is evaluated only after stop settles');
  assert.ok(restartAt > remainingAt, 'restart is conditional on a remaining owner');
  assert.ok(publishAt > restartAt);
  assert.ok(returnAt > publishAt, 'owner OFF awaits the full stop/restart transition');
  assert.doesNotMatch(
    stopShared.slice(transitionAt, stopAt),
    /iconSurfaceOwners\.size === 0/,
    'shared work must be cleared even while the other owner remains ON',
  );

  const iconStopAt = iconResolverSource.indexOf('export function stopIconSource()');
  const iconStop = iconResolverSource.slice(iconStopAt);
  const markStoppingAt = iconStop.indexOf("lifecycleState = 'STOPPING'");
  const clearQueueAt = iconStop.indexOf('queue = []', markStoppingAt);
  const clearPendingAt = iconStop.indexOf('pending.clear()', clearQueueAt);
  const abortAt = iconStop.indexOf('activeSearchController?.abort(', clearPendingAt);
  const ownedRunAt = iconStop.indexOf('const owned = drainRun', abortAt);
  const awaitOwnedAt = iconStop.indexOf('Promise.allSettled(owned ? [owned] : [])', ownedRunAt);
  const settleAt = iconStop.indexOf('settle()', awaitOwnedAt);
  assert.ok(iconStopAt >= 0);
  assert.ok(markStoppingAt >= 0);
  assert.ok(clearQueueAt > markStoppingAt);
  assert.ok(clearPendingAt > clearQueueAt);
  assert.ok(abortAt > clearPendingAt, 'active prior-owner work is cancelled after queues are cleared');
  assert.ok(ownedRunAt > abortAt);
  assert.ok(awaitOwnedAt > ownedRunAt, 'global stop waits for the prior drain generation');
  assert.ok(settleAt > awaitOwnedAt, 'shared-owner transition cannot restart before prior work settles');
});

test('retained refresh route leases optional News and Calendar work or skips it fail-closed', () => {
  const routeMapping = sourceBetween(
    'function optionalSurfaceForRequest(',
    "app.use('/api', (req, res, next) =>",
  );
  const refreshRoute = sourceBetween(
    "app.post('/api/refresh',",
    "app.get('/api/apikey',",
  );

  assert.doesNotMatch(
    routeMapping,
    /pathname === '\/api\/refresh'/,
    'the retained refresh route itself must remain available',
  );
  assert.match(
    refreshRoute,
    /const runOptionalStep = async \([\s\S]*?surface: 'news' \| 'calendar'/,
  );
  const acquireAt = refreshRoute.indexOf('optionalSurfaceControl.acquire(surface)');
  const skippedAt = refreshRoute.indexOf('skipped: ${surface} optional surface is OFF');
  const invokeAt = refreshRoute.indexOf('await runStep(key, async () =>', acquireAt);
  const releaseAt = refreshRoute.indexOf('lease.release()');
  assert.ok(acquireAt >= 0);
  assert.ok(skippedAt > acquireAt, 'an OFF optional owner must be skipped without invoking work');
  assert.ok(invokeAt > skippedAt, 'refresh work is reachable only with an acquired lease');
  assert.ok(releaseAt > invokeAt, 'the lease must release after optional refresh work settles');
  assert.match(refreshRoute, /if \(lease\.signal\.aborted\) throw new OptionalSurfaceOffError\(surface\)/);
  assert.match(
    refreshRoute,
    /if \(target === 'news'\) \{[\s\S]*?runOptionalStep\('news', 'news-context',[\s\S]*?refreshNewsContextNow\(\)/,
  );
  assert.match(
    refreshRoute,
    /if \(target === 'calendar'\) \{[\s\S]*?runOptionalStep\('calendar', 'economic-calendar',[\s\S]*?startCalendarRefresh\(\)/,
  );
  assert.doesNotMatch(
    refreshRoute,
    /setEnabled\((?:'news'|'calendar'),\s*true\)/,
    'core refresh must never turn an optional surface back on',
  );
});

test('Token WebSocket book subscriptions acquire one bound lease before hub dispatch and release on every terminal path', () => {
  const bookLifecycle = sourceBetween(
    'const createBookHub =',
    "app.disable('x-powered-by')",
  );
  const releaseSubscription = sourceBetween(
    'function releaseBookSubscription(',
    'function handleBookStreamMessage(',
  );
  const validateSubscription = sourceBetween(
    'function validBookSubscriptionSymbol(',
    'function releaseBookSubscription(',
  );
  const handleMessage = sourceBetween(
    'function handleBookStreamMessage(',
    'function resetBookStreamRuntime(',
  );
  const websocketConnection = sourceBetween(
    "wss.on('connection',",
    'type BoundedWebSocketFrame =',
  );

  assert.match(bookLifecycle, /let bookHub = createBookHub\(\)/);
  assert.match(
    bookLifecycle,
    /new Map<WebSocket,\s*Readonly<\{[\s\S]*?hub: BookStreamHub;[\s\S]*?lease: OptionalSurfaceLease;[\s\S]*?\}>>\(\)/,
    'each socket must retain the exact hub and Token lease generation it acquired',
  );
  assert.match(validateSubscription, /message\.type !== 'sub-book'/);
  assert.match(validateSubscription, /engine\.filters\.has\(symbol\) \? symbol : null/);

  const bindingAt = releaseSubscription.indexOf('bookSurfaceLeases.get(ws)');
  const recordedHubDropAt = releaseSubscription.indexOf('binding.hub.drop(ws)');
  const deleteAt = releaseSubscription.indexOf('bookSurfaceLeases.delete(ws)');
  const releaseAt = releaseSubscription.indexOf('binding.lease.release()');
  assert.ok(bindingAt >= 0);
  assert.ok(recordedHubDropAt > bindingAt, 'cleanup drops the hub recorded by this socket');
  assert.ok(deleteAt > recordedHubDropAt, 'cleanup removes the binding before releasing its lease');
  assert.ok(releaseAt > deleteAt, 'cleanup releases exactly the removed binding');

  assert.match(
    handleMessage,
    /message\.type === 'unsub-book'[\s\S]*?releaseBookSubscription\(ws\);[\s\S]*?return;/,
    'unsubscribe must release before returning',
  );
  const validSubscriptionAt = handleMessage.indexOf('validBookSubscriptionSymbol(raw) !== null');
  const oneLeaseAt = handleMessage.indexOf('!bookSurfaceLeases.has(ws)', validSubscriptionAt);
  const acquireAt = handleMessage.indexOf("optionalSurfaceControl.acquire('token')", oneLeaseAt);
  const bindAt = handleMessage.indexOf('bookSurfaceLeases.set(ws,', acquireAt);
  const dispatchAt = handleMessage.indexOf('.handleMessage(ws, raw)', bindAt);
  assert.ok(validSubscriptionAt >= 0);
  assert.ok(oneLeaseAt > validSubscriptionAt, 'only valid sub-book demand reaches Token admission');
  assert.ok(acquireAt > oneLeaseAt, 'a socket without a binding acquires Token admission');
  assert.ok(bindAt > acquireAt, 'the acquired lease is bound to the current hub');
  assert.ok(dispatchAt > bindAt, 'hub dispatch cannot precede Token lease acquisition');
  assert.equal(
    handleMessage.match(/optionalSurfaceControl\.acquire\('token'\)/g)?.length,
    1,
    'the handler has one Token acquisition site and reuses an existing socket binding',
  );
  assert.match(
    handleMessage,
    /bookSurfaceLeases\.set\(ws,\s*Object\.freeze\(\{\s*hub: bookHub,\s*lease\s*\}\)\)/,
  );
  assert.match(
    handleMessage,
    /\(bookSurfaceLeases\.get\(ws\)\?\.hub \?\? bookHub\)\.handleMessage\(ws, raw\)/,
    'dispatch uses the hub pinned alongside the lease',
  );

  const errorAt = websocketConnection.indexOf("ws.on('error',");
  const pongAt = websocketConnection.indexOf("ws.on('pong',", errorAt);
  assert.ok(errorAt >= 0);
  assert.ok(pongAt > errorAt);
  assert.match(
    websocketConnection.slice(errorAt, pongAt),
    /releaseBookSubscription\(ws\);[\s\S]*?ws\.terminate\(\)/,
  );
  assert.match(
    websocketConnection,
    /ws\.on\('close', \(\) => releaseBookSubscription\(ws\)\)/,
  );
});

test('Token stop synchronously retires the old book hub and every lease before replacing the hub', () => {
  const resetRuntime = sourceBetween(
    'function resetBookStreamRuntime(',
    "app.disable('x-powered-by')",
  );
  const tokenRuntime = sourceBetween(
    "optionalSurfaceControl.registerRuntime('token',",
    "optionalSurfaceControl.registerRuntime('markets',",
  );

  assert.doesNotMatch(resetRuntime, /\bawait\b/, 'book teardown must finish synchronously');
  const captureAt = resetRuntime.indexOf('const drainingHub = bookHub');
  const stopAt = resetRuntime.indexOf('drainingHub.stop()', captureAt);
  const iterateAt = resetRuntime.indexOf('for (const [ws, binding] of bookSurfaceLeases)', stopAt);
  const dropAt = resetRuntime.indexOf('binding.hub.drop(ws)', iterateAt);
  const deleteAt = resetRuntime.indexOf('bookSurfaceLeases.delete(ws)', dropAt);
  const releaseAt = resetRuntime.indexOf('binding.lease.release()', deleteAt);
  const replaceAt = resetRuntime.indexOf('bookHub = createBookHub()', releaseAt);
  assert.ok(captureAt >= 0);
  assert.ok(stopAt > captureAt, 'the exact old hub is stopped first');
  assert.ok(iterateAt > stopAt, 'all socket bindings are drained from the stopped generation');
  assert.ok(dropAt > iterateAt);
  assert.ok(deleteAt > dropAt);
  assert.ok(releaseAt > deleteAt);
  assert.ok(replaceAt > releaseAt, 'only a fully drained generation may be replaced');

  const stopHookAt = tokenRuntime.indexOf('stop: async');
  const resetAt = tokenRuntime.indexOf('resetBookStreamRuntime()', stopHookAt);
  const firstAwaitAt = tokenRuntime.indexOf('await', stopHookAt);
  assert.ok(stopHookAt >= 0);
  assert.ok(resetAt > stopHookAt);
  assert.ok(firstAwaitAt > resetAt, 'Token stop replaces the book generation before any async teardown');
});

test('production leaf hooks are registered and shutdown stops optional control before retained runtimes', () => {
  const runtimeHooks = sourceBetween(
    "optionalSurfaceControl.registerRuntime('news',",
    '// Conventional probe paths',
  );
  const shutdown = sourceBetween(
    'function gracefulShutdown(',
    '// EX_TEMPFAIL:',
  );

  for (const hook of [
    'startNewsContextRuntime',
    'stopNewsContextRuntime',
    'startProfileSource',
    'stopProfileSource',
    'startMoneyFlow',
    'stopMoneyFlow',
    'startSharedIconSource',
    'stopSharedIconSource',
  ]) {
    assert.match(runtimeHooks, new RegExp(`\\b${hook}\\(`), `${hook} must be lifecycle-bound`);
  }
  for (const surface of OPTIONAL_SURFACE_IDS) {
    assert.match(
      runtimeHooks,
      new RegExp(`optionalSurfaceControl\\.registerRuntime\\('${surface}'`),
      `${surface} runtime must be registered`,
    );
  }

  const stopAllAt = shutdown.indexOf('await optionalSurfaceControl.stopAll()');
  assert.ok(stopAllAt >= 0);
  assert.ok(stopAllAt < shutdown.indexOf('privateRead.stop()'));
  assert.ok(stopAllAt < shutdown.indexOf('bookHub.stop()'));

  assert.doesNotMatch(volumeRuntimeSource, /optionalSurface/i);
  assert.doesNotMatch(bookStreamSource, /optionalSurface/i);
});

test('optional leaf modules import stopped and expose deterministic lifecycle counters', async (t) => {
  const lifecycleCut = () => {
    const icons = iconSourceLifecycle();
    const profile = profileSourceLifecycle();
    const moneyFlow = moneyFlowLifecycle();
    return {
      icons: [
        icons.state,
        icons.startCount,
        icons.stopCount,
        icons.queued + icons.pending + Number(icons.draining) + Number(icons.activeRequest),
      ],
      profile: [
        profile.state,
        profile.startCount,
        profile.stopCount,
        profile.activeRequests + profile.queuedRequests + profile.inFlightKeys + Number(profile.warming),
      ],
      moneyFlow: [moneyFlow.running, moneyFlow.generation, moneyFlow.activeWalks],
    };
  };

  t.after(async () => {
    await Promise.all([
      stopIconSource(),
      stopProfileSource(),
      stopMoneyFlow(),
    ]);
  });

  assert.deepEqual(lifecycleCut(), {
    icons: ['STOPPED', 0, 0, 0],
    profile: ['STOPPED', 0, 0, 0],
    moneyFlow: [false, 0, 0],
  });
  assert.equal(newsContextStatus().refreshing, false);

  startIconSource();
  startProfileSource();
  startMoneyFlow();

  assert.deepEqual(lifecycleCut(), {
    icons: ['STARTED', 1, 0, 0],
    profile: ['STARTED', 1, 0, 0],
    moneyFlow: [true, 1, 0],
  });

  await Promise.all([
    stopIconSource(),
    stopProfileSource(),
    stopMoneyFlow(),
  ]);

  assert.deepEqual(lifecycleCut(), {
    icons: ['STOPPED', 1, 1, 0],
    profile: ['STOPPED', 1, 1, 0],
    moneyFlow: [false, 1, 0],
  });
  assert.equal(newsContextStatus().refreshing, false);
});
