import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ACTIVE_PAGE_STORAGE_KEY,
  CANONICAL_DASHBOARD_PATH,
  DEFAULT_DETAIL_SYMBOL,
  DETAIL_SYMBOL_STORAGE_KEY,
  RELEASE_IDENTITY_UNKNOWN_TEXT,
  canonicalizeTokenSymbol,
  createDurableRouteController,
  isPageId,
  marketSnapshotTruthEvent,
  parseRoutePath,
  resolveInitialRouteTarget,
  resolveMemoryRouteTarget,
  resolveReleaseIdentityTruth,
  routeTarget,
  serializeRoute,
} from '../../src/store.tsx';

const read = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8');

// Every page the shell renders in App.tsx, with the Account subview ids that
// DESIGN.md §3 routes onto the single controlled Account page.
const PAGES = [
  'dashboard', 'control-room', 'account', 'wallets', 'markets', 'detail', 'loans', 'execution',
  'orders', 'positions', 'fills', 'pnl', 'strategies', 'volume', 'opportunities', 'risk', 'ledger',
  'system', 'watchdog', 'notifications', 'news', 'calendar',
];

/** Deterministic, DOM-free stand-in for window.location + window.history. */
function createRouteIoRecorder(initialPath) {
  const writes = [];
  let path = initialPath;
  return {
    writes,
    get path() {
      return path;
    },
    // The browser moves the URL itself on Back/Forward; the shell only reads it.
    simulateBrowserPop: (next) => {
      path = next;
    },
    io: Object.freeze({
      readPath: () => path,
      pushPath: (next) => {
        writes.push({ kind: 'PUSH', path: next });
        path = next;
      },
      replacePath: (next) => {
        writes.push({ kind: 'REPLACE', path: next });
        path = next;
      },
    }),
  };
}

const memory = (overrides = {}) => resolveMemoryRouteTarget({
  savedPage: null,
  savedSymbol: null,
  defaultPage: null,
  ...overrides,
});

test('every visible page has a unique canonical path that parses back to itself', () => {
  const paths = new Map();
  for (const page of PAGES) {
    assert.equal(isPageId(page), true, `${page} must be a known page id`);
    const target = page === 'detail' ? routeTarget('detail', 'ETHUSDT') : routeTarget(page);
    const path = serializeRoute(target);

    assert.match(path, /^\/[a-z0-9/-]+$/i, `${page} must serialize to an absolute path`);
    assert.equal(paths.has(path), false, `${path} is claimed by two pages`);
    paths.set(path, page);

    const parsed = parseRoutePath(path);
    assert.equal(parsed.status, 'CANONICAL', `${path} must be canonical`);
    assert.equal(parsed.target.page, page);
    if (page === 'detail') assert.equal(parsed.target.detailSymbol, 'ETHUSDT');
  }
  assert.equal(paths.size, PAGES.length);

  // The Account subviews are nested, and Token Detail carries its symbol.
  assert.equal(serializeRoute(routeTarget('account')), '/account');
  for (const subview of ['execution', 'orders', 'positions', 'fills', 'pnl']) {
    assert.equal(serializeRoute(routeTarget(subview)), `/account/${subview}`);
  }
  assert.equal(serializeRoute(routeTarget('wallets')), '/account/wallets');
  assert.equal(serializeRoute(routeTarget('loans')), '/borrow');
  assert.equal(serializeRoute(routeTarget('strategies')), '/basis');
  assert.equal(serializeRoute(routeTarget('ledger')), '/logs');
  assert.equal(serializeRoute(routeTarget('system')), '/health');
  assert.equal(serializeRoute(routeTarget('detail', 'BTCUSDT')), '/token/BTCUSDT');
  assert.equal(serializeRoute(routeTarget('dashboard')), CANONICAL_DASHBOARD_PATH);
});

test('market publication truth cannot promote a 200 stale or unavailable snapshot to current', () => {
  const now = 1_785_489_600_000;
  assert.deepEqual(
    marketSnapshotTruthEvent({
      spotBookTicker: 'fresh',
      futuresBookTicker: 'fresh',
      futures24hTicker: 'fresh',
    }, now),
    { kind: 'SUCCESS', observedAtMs: now },
  );

  const stale = marketSnapshotTruthEvent({
    spotBookTicker: 'fresh',
    futuresBookTicker: 'stale',
    futures24hTicker: 'unavailable',
  }, now);
  assert.equal(stale.kind, 'FAILURE');
  assert.match(stale.error, /futuresBookTicker=stale/);
  assert.match(stale.error, /futures24hTicker=unavailable/);

  const missing = marketSnapshotTruthEvent(undefined, now);
  assert.deepEqual(missing, {
    kind: 'FAILURE',
    observedAtMs: now,
    error: 'Market source truth is missing.',
  });
});

test('global market surfaces never render unlabelled retained prices', async () => {
  const [tape, palette] = await Promise.all([
    read('components/Tape.tsx'),
    read('components/Palette.tsx'),
  ]);
  assert.match(tape, /marketStatus !== ['"]CURRENT['"] \|\| markets\.length === 0/);
  assert.match(palette, /marketStatus === ['"]STALE['"]/);
  assert.match(palette, /STALE LAST-KNOWN/);
  assert.match(palette, /Market facts unavailable/);
});

test('non-canonical but honest paths normalize; unroutable paths stay unknown', () => {
  const normalized = [
    ['/markets/', 'markets', null],
    ['//markets', 'markets', null],
    ['/MARKETS', 'markets', null],
    ['/account/overview', 'account', null],
    ['/account/ORDERS', 'orders', null],
    ['/token/btcusdt', 'detail', 'BTCUSDT'],
    ['/token/ethusdt/', 'detail', 'ETHUSDT'],
    ['/token/%62tcusdt', 'detail', 'BTCUSDT'],
  ];
  for (const [path, page, symbol] of normalized) {
    const parsed = parseRoutePath(path);
    assert.equal(parsed.status, 'NORMALIZED', `${path} must normalize`);
    assert.equal(parsed.target.page, page);
    if (symbol !== null) assert.equal(parsed.target.detailSymbol, symbol);
  }

  // A query or fragment is not part of route identity. The shell only ever
  // passes location.pathname, so this is defensive tolerance: the route is
  // read from the path and the rest is left untouched.
  for (const path of ['/markets?tab=spot', '/markets#top']) {
    const parsed = parseRoutePath(path);
    assert.equal(parsed.status, 'CANONICAL', `${path} carries a canonical route`);
    assert.equal(parsed.target.page, 'markets');
  }

  for (const path of ['', '/', '///']) {
    const parsed = parseRoutePath(path);
    assert.equal(parsed.status, 'NORMALIZED', `${path} normalizes to the dashboard`);
    assert.equal(parsed.target.page, 'dashboard');
  }

  const unknown = [
    '/nope',
    '/detail',
    '/token',
    '/token/',
    '/token/BTC USDT',
    '/token/BT$C',
    '/token/B',
    '/token/BTCUSDT/extra',
    '/account/withdraw',
    '/account/orders/1',
    '/%ZZ',
    null,
    undefined,
    42,
  ];
  for (const path of unknown) {
    const parsed = parseRoutePath(path);
    assert.equal(parsed.status, 'UNKNOWN', `${String(path)} must be unknown`);
    assert.equal(parsed.target, null);
  }
});

test('token symbols are validated and canonicalized before they can reach a route', () => {
  assert.equal(canonicalizeTokenSymbol(' btcusdt '), 'BTCUSDT');
  assert.equal(canonicalizeTokenSymbol('ETHUSDT'), 'ETHUSDT');
  assert.equal(canonicalizeTokenSymbol('1000SATSUSDT'), '1000SATSUSDT');
  for (const invalid of ['', ' ', 'AB', 'BTC-USDT', 'BTC/USDT', 'BTC USDT', 'a'.repeat(21), null, 7, {}]) {
    assert.equal(canonicalizeTokenSymbol(invalid), null, `${String(invalid)} is not a symbol`);
  }
  // A detail target with no honest symbol has no token path.
  assert.equal(serializeRoute({ page: 'detail', detailSymbol: 'BTC/USDT' }), CANONICAL_DASHBOARD_PATH);
  assert.equal(serializeRoute({ page: 'detail' }), CANONICAL_DASHBOARD_PATH);
  assert.equal(serializeRoute({ page: 'not-a-page' }), CANONICAL_DASHBOARD_PATH);
});

test('compatibility memory falls back saved page -> default page -> dashboard', () => {
  assert.deepEqual(memory({ savedPage: 'risk', defaultPage: 'news' }), { page: 'risk', detailSymbol: DEFAULT_DETAIL_SYMBOL });
  assert.deepEqual(memory({ savedPage: 'bogus', defaultPage: 'news' }), { page: 'news', detailSymbol: DEFAULT_DETAIL_SYMBOL });
  assert.deepEqual(memory({ savedPage: null, defaultPage: 'trade' }), { page: 'dashboard', detailSymbol: DEFAULT_DETAIL_SYMBOL });
  assert.deepEqual(memory({ savedSymbol: 'solusdt' }), { page: 'dashboard', detailSymbol: 'SOLUSDT' });
  assert.deepEqual(memory({ savedSymbol: 'not a symbol' }), { page: 'dashboard', detailSymbol: DEFAULT_DETAIL_SYMBOL });
});

test('an initial valid URL outranks stored and default-page memory, without a history write', () => {
  const recorder = createRouteIoRecorder('/token/SOLUSDT');
  const controller = createDurableRouteController(recorder.io);

  const resolved = controller.resolveInitial(memory({ savedPage: 'ledger', savedSymbol: 'BTCUSDT', defaultPage: 'news' }));
  assert.deepEqual(resolved, { page: 'detail', detailSymbol: 'SOLUSDT' });
  assert.deepEqual(recorder.writes, [], 'an already canonical URL is not rewritten');
});

test('an initial non-canonical URL is repaired with replaceState, never pushState', () => {
  const recorder = createRouteIoRecorder('/token/solusdt/');
  const controller = createDurableRouteController(recorder.io);

  assert.deepEqual(controller.resolveInitial(memory({ savedPage: 'ledger' })), { page: 'detail', detailSymbol: 'SOLUSDT' });
  assert.deepEqual(recorder.writes, [{ kind: 'REPLACE', path: '/token/SOLUSDT' }]);
});

test('a root URL is authoritative over compatibility memory and publishes the dashboard path', () => {
  const recorder = createRouteIoRecorder('/');
  const controller = createDurableRouteController(recorder.io);

  assert.deepEqual(
    controller.resolveInitial(memory({ savedPage: 'detail', savedSymbol: 'ethusdt' })),
    { page: 'dashboard', detailSymbol: 'ETHUSDT' },
  );
  assert.deepEqual(recorder.writes, [{ kind: 'REPLACE', path: CANONICAL_DASHBOARD_PATH }]);
  assert.deepEqual(
    resolveInitialRouteTarget('/', memory({ savedPage: 'risk', savedSymbol: 'solusdt' })),
    { page: 'dashboard', detailSymbol: 'SOLUSDT' },
  );
});

test('an unknown initial URL fails deterministically to the canonical dashboard by replaceState', () => {
  for (const path of ['/nope', '/token/BT$C', '/account/withdraw']) {
    const recorder = createRouteIoRecorder(path);
    const controller = createDurableRouteController(recorder.io);

    const resolved = controller.resolveInitial(memory({ savedPage: 'ledger', savedSymbol: 'ethusdt' }));
    assert.deepEqual(resolved, { page: 'dashboard', detailSymbol: 'ETHUSDT' }, `${path} must fail to the dashboard`);
    assert.deepEqual(recorder.writes, [{ kind: 'REPLACE', path: CANONICAL_DASHBOARD_PATH }]);
    assert.equal(recorder.path, CANONICAL_DASHBOARD_PATH);
    assert.equal(parseRoutePath(recorder.path).status, 'CANONICAL');
  }
});

test('local navigation pushes exactly one entry per distinct route and never repeats one', () => {
  const recorder = createRouteIoRecorder(CANONICAL_DASHBOARD_PATH);
  const controller = createDurableRouteController(recorder.io);
  let current = controller.resolveInitial(memory());
  assert.deepEqual(recorder.writes, []);

  current = controller.navigate(routeTarget('markets'), current);
  assert.deepEqual(current, { page: 'markets', detailSymbol: DEFAULT_DETAIL_SYMBOL });
  current = controller.navigate(routeTarget('markets'), current);
  current = controller.navigate(routeTarget('detail', 'ethusdt'), current);
  assert.deepEqual(current, { page: 'detail', detailSymbol: 'ETHUSDT' });
  current = controller.navigate(routeTarget('detail', 'ETHUSDT'), current);
  current = controller.navigate(routeTarget('orders'), current);

  assert.deepEqual(recorder.writes, [
    { kind: 'PUSH', path: '/markets' },
    { kind: 'PUSH', path: '/token/ETHUSDT' },
    { kind: 'PUSH', path: '/account/orders' },
  ]);
  // Leaving Token Detail keeps the symbol as view state without leaking it
  // into the account path.
  assert.deepEqual(current, { page: 'orders', detailSymbol: 'ETHUSDT' });
  assert.equal(recorder.path, '/account/orders');
});

test('popstate adopts page and detail symbol from history without pushing a new entry', () => {
  const recorder = createRouteIoRecorder('/account/orders');
  const controller = createDurableRouteController(recorder.io);
  let current = controller.resolveInitial(memory());

  assert.deepEqual(current, { page: 'orders', detailSymbol: DEFAULT_DETAIL_SYMBOL });

  recorder.simulateBrowserPop('/token/SOLUSDT');
  current = controller.resolvePop(current);
  assert.deepEqual(current, { page: 'detail', detailSymbol: 'SOLUSDT' });

  recorder.simulateBrowserPop('/risk');
  current = controller.resolvePop(current);
  assert.deepEqual(current, { page: 'risk', detailSymbol: 'SOLUSDT' }, 'the last symbol survives a non-detail entry');

  // A popped entry may be repaired in place, but never pushed.
  recorder.simulateBrowserPop('/token/solusdt');
  current = controller.resolvePop(current);
  assert.deepEqual(current, { page: 'detail', detailSymbol: 'SOLUSDT' });
  assert.deepEqual(recorder.writes, [{ kind: 'REPLACE', path: '/token/SOLUSDT' }]);
  assert.deepEqual(recorder.writes.filter((write) => write.kind === 'PUSH'), [], 'popstate must never push');
});

test('popstate onto an unroutable or root URL resolves to the dashboard by replaceState', () => {
  for (const path of ['/nope', '/']) {
    const recorder = createRouteIoRecorder(path);
    const controller = createDurableRouteController(recorder.io);
    const resolved = controller.resolvePop({ page: 'risk', detailSymbol: 'SOLUSDT' });
    assert.deepEqual(resolved, { page: 'dashboard', detailSymbol: 'SOLUSDT' });
    assert.deepEqual(recorder.writes, [{ kind: 'REPLACE', path: CANONICAL_DASHBOARD_PATH }]);
  }
});

test('release identity renders only present deployment facts', () => {
  const deployedCommit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const present = resolveReleaseIdentityTruth({
    testedCommit: 'ffffffffffffffffffffffffffffffffffffffff',
    deployedCommit,
    modelRevision: null,
    configRevision: '17',
    schemaRevision: 'product-supervisor.v1',
  });
  assert.equal(present.state, 'PRESENT');
  assert.equal(present.fallbackText, null);
  assert.deepEqual(present.facts.map((fact) => fact.id), ['deployed', 'config']);
  assert.equal(present.facts[0].label, 'Deployed');
  assert.equal(present.facts[0].exact, deployedCommit);
  assert.equal(present.facts[0].display, 'a1b2c3d4e5f6');
  assert.equal(present.facts[1].label, 'Config');
  assert.equal(present.facts[1].display, '17');
  assert.equal(present.facts[1].exact, '17');
});

test('release identity is partial when only one deployment fact is published', () => {
  const deployedOnly = resolveReleaseIdentityTruth({
    testedCommit: 'ffffffffffffffffffffffffffffffffffffffff',
    deployedCommit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    modelRevision: 'model-9',
    configRevision: null,
    schemaRevision: 'product-supervisor.v1',
  });
  assert.equal(deployedOnly.state, 'PARTIAL');
  assert.equal(deployedOnly.fallbackText, null);
  assert.deepEqual(deployedOnly.facts.map((fact) => fact.id), ['deployed']);

  const configOnly = resolveReleaseIdentityTruth({ deployedCommit: null, configRevision: 'cfg-42' });
  assert.equal(configOnly.state, 'PARTIAL');
  assert.deepEqual(configOnly.facts.map((fact) => fact.display), ['cfg-42']);
});

test('a supervisor without deployment identity renders the exact unknown text', () => {
  const unknownInputs = [
    null,
    undefined,
    'product-supervisor.v1',
    [],
    { deployedCommit: null, configRevision: null },
    { deployedCommit: '   ', configRevision: '' },
    { deployedCommit: 12345, configRevision: false },
    // A tested commit, a model revision and a schema revision are never
    // deployment identity.
    {
      testedCommit: 'ffffffffffffffffffffffffffffffffffffffff',
      deployedCommit: null,
      modelRevision: 'model-9',
      configRevision: null,
      schemaRevision: 'product-supervisor.v1',
    },
  ];
  for (const input of unknownInputs) {
    const truth = resolveReleaseIdentityTruth(input);
    assert.equal(truth.state, 'UNKNOWN', `${JSON.stringify(input) ?? String(input)} has no deployment identity`);
    assert.deepEqual(truth.facts, []);
    assert.equal(truth.fallbackText, RELEASE_IDENTITY_UNKNOWN_TEXT);
    assert.equal(truth.fallbackText, 'Release Identity Unknown');
  }
});

test('the shell wires the durable router and the supervisor release identity, and drops the candidate label', async () => {
  const [store, app] = await Promise.all([read('store.tsx'), read('App.tsx')]);

  // Routing rides the native History API through the injected controller only.
  assert.match(store, /window\.history\.pushState\(null, '', path\)/);
  assert.match(store, /window\.history\.replaceState\(null, '', path\)/);
  assert.match(store, /window\.addEventListener\('popstate', onPopState\)/);
  assert.match(store, /window\.removeEventListener\('popstate', onPopState\)/);
  assert.equal((store.match(/pushState/g) ?? []).length, 1, 'one pushState owner');
  assert.doesNotMatch(store, /location\.(?:assign|replace|href\s*=)|window\.location\.reload/);

  // localStorage stays compatibility memory under the same legacy keys.
  assert.equal(ACTIVE_PAGE_STORAGE_KEY, 'cosmos-active-page');
  assert.equal(DETAIL_SYMBOL_STORAGE_KEY, 'cosmos-detail-symbol');
  assert.match(store, /localStorage\.setItem\(ACTIVE_PAGE_STORAGE_KEY, target\.page\)/);
  assert.match(store, /localStorage\.setItem\(DETAIL_SYMBOL_STORAGE_KEY, target\.detailSymbol\)/);
  assert.match(store, /resolveMemoryRouteTarget\(\{/);
  assert.match(store, /routeController\.resolveInitial\(/);
  assert.match(store, /routeController\.navigate\(/);
  assert.match(store, /routeController\.resolvePop\(/);
  assert.match(store, /if \(isCanonicalSupervisorDeltaMessage\(data\)\) \{\s*\/\/ Protocol-valid connection evidence only\./);
  assert.doesNotMatch(store, /if \(isCanonicalSupervisorDeltaMessage\(data\)\) requestCompatibilityState/);

  // The Store navigation API is unchanged for every existing caller.
  for (const member of ['page: Page;', 'setPage: (p: Page) => void;', 'detailSymbol: string;', 'openDetail: (symbol: string) => void;']) {
    assert.ok(store.includes(member), `Store must keep ${member}`);
  }
  assert.match(store, /setPage: changePage,/);

  // The footer states deployment truth, and the invented label is gone.
  assert.doesNotMatch(app, /Local Candidate/);
  assert.match(app, /resolveReleaseIdentityTruth\(productSnapshot\?\.ownerView\.revisions \?\? null\)/);
  assert.match(app, /releaseIdentity\.fallbackText !== null/);
  assert.match(app, /releaseIdentity\.facts\.map/);
  assert.doesNotMatch(app, /releaseIdentity[\s\S]{0,400}(?:testedCommit|schemaRevision)/);
});
