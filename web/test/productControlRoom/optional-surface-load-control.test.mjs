import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DEFAULT_OPTIONAL_SURFACES,
  OPTIONAL_SURFACE_IDS,
  decodeOptionalSurfaceMutationResponse,
  decodeOptionalSurfaceResponse,
  mergeOptionalSurfaceSnapshot,
  mergeOptionalSurfaceSnapshots,
  optionalSurfaceAllowsOverlay,
  optionalSurfaceEnabled,
  optionalSurfaceForPage,
} from '../../src/lib/optionalSurfaceControl.ts';
import {
  onIcons,
  primeIcons,
  requestIcon,
  setIconManifestAdmission,
} from '../../src/lib/iconManifest.ts';

const read = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8');

const snapshot = (id, overrides = {}) => Object.freeze({
  id,
  desiredState: 'OFF',
  phase: 'OFF',
  generation: 0,
  admissionOpen: false,
  inFlight: 0,
  failureCode: null,
  ...overrides,
});

const surfacesWith = (id, overrides) => Object.freeze({
  ...DEFAULT_OPTIONAL_SURFACES,
  [id]: snapshot(id, overrides),
});

test('all optional surfaces default OFF and unknown control truth fails closed', () => {
  assert.deepEqual([...OPTIONAL_SURFACE_IDS].sort(), [
    'calendar',
    'logs',
    'markets',
    'news',
    'token',
  ]);

  for (const id of OPTIONAL_SURFACE_IDS) {
    assert.deepEqual(DEFAULT_OPTIONAL_SURFACES[id], snapshot(id), `${id} must start inert`);

    const apparentlyOn = surfacesWith(id, {
      desiredState: 'ON',
      phase: 'ON',
      generation: 4,
      admissionOpen: true,
    });
    assert.equal(optionalSurfaceEnabled({ status: 'LOADING', surfaces: apparentlyOn }, id), false);
    assert.equal(optionalSurfaceEnabled({ status: 'UNAVAILABLE', surfaces: apparentlyOn }, id), false);
    assert.equal(optionalSurfaceEnabled({ status: 'CURRENT', surfaces: DEFAULT_OPTIONAL_SURFACES }, id), false);
    assert.equal(optionalSurfaceEnabled({ status: 'CURRENT', surfaces: apparentlyOn }, id), true);
    assert.equal(optionalSurfaceEnabled({
      status: 'CURRENT',
      surfaces: apparentlyOn,
      pending: new Set([id]),
    }, id), false, `${id} must close while its mutation is pending`);

    for (const invalid of [
      { desiredState: 'OFF', phase: 'ON', admissionOpen: true },
      { desiredState: 'ON', phase: 'STARTING', admissionOpen: true },
      { desiredState: 'ON', phase: 'DRAINING', admissionOpen: true },
      { desiredState: 'ON', phase: 'ON', admissionOpen: false },
      { desiredState: 'ON', phase: 'ON', admissionOpen: true, failureCode: 'START_FAILED' },
    ]) {
      assert.equal(
        optionalSurfaceEnabled({ status: 'CURRENT', surfaces: surfacesWith(id, invalid) }, id),
        false,
        `${id} must require one exact admitted backend state`,
      );
    }
  }
});

test('page and overlay admission maps only the five optional surfaces', () => {
  assert.deepEqual(
    Object.fromEntries([
      'markets',
      'detail',
      'ledger',
      'news',
      'calendar',
      'dashboard',
      'opportunities',
    ].map((page) => [page, optionalSurfaceForPage(page)])),
    {
      markets: 'markets',
      detail: 'token',
      ledger: 'logs',
      news: 'news',
      calendar: 'calendar',
      dashboard: null,
      opportunities: null,
    },
  );

  for (const overlay of ['news', 'calendar']) {
    const on = surfacesWith(overlay, {
      desiredState: 'ON',
      phase: 'ON',
      generation: 1,
      admissionOpen: true,
    });
    assert.equal(optionalSurfaceAllowsOverlay({ status: 'LOADING', surfaces: on }, overlay), false);
    assert.equal(optionalSurfaceAllowsOverlay({ status: 'UNAVAILABLE', surfaces: on }, overlay), false);
    assert.equal(optionalSurfaceAllowsOverlay({ status: 'CURRENT', surfaces: on }, overlay), true);
  }
});

test('GET and PUT wire decoders reject partial, duplicate, and optimistic admission truth', () => {
  const offRows = OPTIONAL_SURFACE_IDS.map((id) => snapshot(id));
  const decoded = decodeOptionalSurfaceResponse({ surfaces: offRows });
  assert.ok(decoded);
  for (const id of OPTIONAL_SURFACE_IDS) assert.deepEqual(decoded[id], snapshot(id));

  assert.equal(decodeOptionalSurfaceResponse({ surfaces: offRows.slice(1) }), null);
  assert.equal(decodeOptionalSurfaceResponse({ surfaces: [...offRows.slice(0, -1), offRows[0]] }), null);
  assert.equal(decodeOptionalSurfaceResponse({ surfaces: offRows, extra: true }), null);
  assert.equal(decodeOptionalSurfaceResponse({
    surfaces: offRows.map((row) => row.id === 'markets'
      ? { ...row, desiredState: 'OFF', phase: 'OFF', admissionOpen: true }
      : row),
  }), null);

  const applied = decodeOptionalSurfaceMutationResponse({
    status: 'APPLIED',
    snapshot: snapshot('news', {
      desiredState: 'ON',
      phase: 'ON',
      generation: 1,
      admissionOpen: true,
    }),
  });
  assert.equal(applied?.status, 'APPLIED');
  assert.equal(applied?.snapshot.id, 'news');
  const failed = decodeOptionalSurfaceMutationResponse({
    status: 'APPLIED',
    snapshot: snapshot('news', {
      phase: 'FAILED',
      generation: 2,
      failureCode: 'OPTIONAL_SURFACE_START_FAILED',
    }),
  });
  assert.equal(failed?.snapshot.phase, 'FAILED');
  assert.equal(failed?.snapshot.failureCode, 'OPTIONAL_SURFACE_START_FAILED');
  assert.equal(optionalSurfaceEnabled({
    status: 'CURRENT',
    surfaces: Object.freeze({ ...DEFAULT_OPTIONAL_SURFACES, news: failed.snapshot }),
  }, 'news'), false);
  assert.equal(decodeOptionalSurfaceMutationResponse({ status: 'APPLIED', snapshot: offRows }), null);
  assert.equal(decodeOptionalSurfaceMutationResponse({
    status: 'ACCEPTED',
    snapshot: snapshot('news'),
  }), null);
});

test('GET and PUT races preserve monotonic terminal truth and pending closes icon admission', async () => {
  const terminalPut = snapshot('markets', {
    desiredState: 'OFF',
    phase: 'OFF',
    generation: 8,
  });
  const olderGet = snapshot('markets', {
    desiredState: 'ON',
    phase: 'ON',
    generation: 7,
    admissionOpen: true,
  });
  const sameGenerationGet = snapshot('markets', {
    desiredState: 'ON',
    phase: 'ON',
    generation: 8,
    admissionOpen: true,
  });
  assert.equal(
    mergeOptionalSurfaceSnapshot(terminalPut, olderGet),
    terminalPut,
    'a pre-PUT lower-generation GET must not overwrite terminal PUT truth',
  );
  assert.equal(
    mergeOptionalSurfaceSnapshot(terminalPut, sameGenerationGet),
    terminalPut,
    'same-generation terminal PUT truth must not regress to a contradictory GET phase',
  );

  const current = Object.freeze({ ...DEFAULT_OPTIONAL_SURFACES, markets: terminalPut });
  const olderPoll = Object.freeze({ ...DEFAULT_OPTIONAL_SURFACES, markets: olderGet });
  const sameGenerationPoll = Object.freeze({ ...DEFAULT_OPTIONAL_SURFACES, markets: sameGenerationGet });
  assert.equal(mergeOptionalSurfaceSnapshots(current, olderPoll), current);
  assert.equal(mergeOptionalSurfaceSnapshots(current, sameGenerationPoll), current);

  const newerGet = snapshot('markets', {
    desiredState: 'ON',
    phase: 'STARTING',
    generation: 9,
  });
  assert.equal(
    mergeOptionalSurfaceSnapshot(terminalPut, newerGet),
    newerGet,
    'a strictly newer lifecycle generation must remain admissible',
  );

  const control = await read('components/OptionalSurfaceGate.tsx');
  assert.match(control, /const requestEpochRef = useRef\(0\)/);
  assert.match(control, /return Object\.freeze\(\{ requestEpoch: activeRequestEpoch, surfaces \}\)/);
  assert.match(control, /onSuccess: \(\{ requestEpoch, surfaces \}\) => \{\s*if \(requestEpoch !== requestEpochRef\.current\) return;/);
  assert.match(control, /onError: \(error\) => \{\s*if \(activeRequestEpoch !== requestEpochRef\.current\) return;/);

  const mutationStart = control.indexOf('const setEnabled = useCallback(async');
  const mutationEnd = control.indexOf('\n  const token = state.surfaces.token;', mutationStart);
  assert.ok(mutationStart >= 0 && mutationEnd > mutationStart, 'optional surface mutation owner is missing');
  const mutation = control.slice(mutationStart, mutationEnd);
  const epochFenceAt = mutation.indexOf('requestEpochRef.current += 1;');
  const pendingAt = mutation.indexOf('setPending((current) => new Set(current).add(id));');
  const iconCloseAt = mutation.indexOf('setIconManifestAdmission(id, false, state.surfaces[id].generation);');
  const putAt = mutation.indexOf('fetchJsonResponse<OptionalSurfaceMutationResponse>');
  assert.ok(
    epochFenceAt >= 0 && pendingAt > epochFenceAt && iconCloseAt > pendingAt && putAt > iconCloseAt,
    'pending mutation must fence GET state and close icon admission before starting PUT',
  );
  assert.equal(
    (mutation.match(/requestEpochRef\.current \+= 1;/g) ?? []).length,
    2,
    'GET responses begun before or during PUT must remain fenced through mutation settlement',
  );
  assert.match(control, /const tokenEnabled = optionalSurfaceEnabled\(state, 'token'\) && !pending\.has\('token'\)/);
  assert.match(control, /const marketsEnabled = optionalSurfaceEnabled\(state, 'markets'\) && !pending\.has\('markets'\)/);
  assert.match(
    mutation,
    /\}, \[pending, state\.status, state\.surfaces\]\);/,
    'synchronous pending closure must use the current surface generation',
  );
});

test('cold Dashboard keeps optional routes lazy and Opportunities outside every optional gate', async () => {
  const app = await read('App.tsx');
  const lazyRoutes = [
    ['Markets', 'markets', 'Markets'],
    ['TokenDetail', 'token', 'TokenDetail'],
    ['LedgerPage', 'logs', 'LedgerPage'],
    ['News', 'news', 'News'],
    ['CalendarPage', 'calendar', 'CalendarPage'],
  ];

  assert.match(app, /import \{[^}]*\bSuspense\b[^}]*\blazy\b[^}]*\} from 'react'/);
  for (const [moduleName, surfaceId, componentName] of lazyRoutes) {
    assert.doesNotMatch(
      app,
      new RegExp(`import\\s*\\{[^}]*\\b${moduleName}\\b[^}]*\\}\\s*from\\s*['"]\\.\\/pages\\/${moduleName}['"]`),
      `${moduleName} must not join the initial module graph`,
    );
    assert.match(
      app,
      new RegExp(`const ${componentName} = lazy\\(async \\(\\) => \\{[\\s\\S]{0,120}import\\(['"]\\.\\/pages\\/${moduleName}['"]\\)`),
      `${moduleName} must own a deferred chunk`,
    );
    assert.match(
      app,
      new RegExp(
        `page === '[^']+'[\\s\\S]{0,180}<OptionalSurfaceGate surfaceId=["']${surfaceId}["']>`
        + `[\\s\\S]{0,240}<${componentName}\\b`,
      ),
      `${moduleName} must remain behind backend admission`,
    );
  }

  assert.match(app, /page === 'dashboard' && <Dashboard \/>/);
  assert.match(app, /page === 'opportunities' && <Opportunities \/>/);
  assert.doesNotMatch(app, /OptionalSurfaceGate surfaceId=["']opportunities["']/);
  assert.equal((app.match(/<OptionalSurfaceControlProvider>/g) ?? []).length, 1);

  // Preserve source-discovered route contracts used by I00 and product-control tests.
  for (const page of [
    'dashboard',
    'control-room',
    'account',
    'wallets',
    'markets',
    'detail',
    'loans',
    'execution',
    'orders',
    'positions',
    'fills',
    'pnl',
    'strategies',
    'volume',
    'opportunities',
    'risk',
    'ledger',
    'system',
    'notifications',
    'news',
    'calendar',
  ]) {
    assert.match(app, new RegExp(`page === '${page}'`), `${page} literal route must remain discoverable`);
  }
});

test('sidebar switches are sibling controls and token discovery closes when Token is OFF', async () => {
  const [header, gate, palette, styles] = await Promise.all([
    read('components/Header.tsx'),
    read('components/OptionalSurfaceGate.tsx'),
    read('components/Palette.tsx'),
    read('styles.css'),
  ]);

  const rowStart = header.indexOf('<div className="snav-optional-row"');
  const rowEnd = header.indexOf('</div>', rowStart);
  assert.ok(rowStart >= 0 && rowEnd > rowStart, 'sidebar optional row wrapper is missing');
  const row = header.slice(rowStart, rowEnd);
  assert.match(row, /className=\{`snav-item /);
  assert.match(row, /data-nav-id=\{n\.id\}/);
  assert.match(row, /<\/button>[\s\S]*<OptionalSurfaceSwitch surfaceId=\{optionalSurface\} compact \/>/);
  assert.doesNotMatch(row, /<button[\s\S]*<button/, 'the switch must not nest inside the route button');

  assert.match(gate, /type="button"[\s\S]*role="switch"[\s\S]*aria-checked=\{checked\}/);
  assert.match(gate, /disabled=\{disabled\}/);
  assert.match(gate, /data-optional-surface=\{surfaceId\}/);
  assert.match(
    gate,
    /<section className="optional-surface-inert" aria-disabled="true"[\s\S]*<\/section>\s*<OptionalSurfaceSwitch surfaceId=\{surfaceId\} \/>/,
    'the active switch must sit outside the inert visual panel',
  );
  assert.doesNotMatch(
    gate,
    /feed, polling, subscriptions, and workers are stopped/i,
    'generic OFF copy must not claim that retained shared/core owners stop',
  );
  assert.match(gate, /passive market cut remains available to Opportunities/);
  assert.match(gate, /durable ledger and canonical incident retention remain active/);
  assert.match(
    styles,
    /\.optional-surface-gate\.closed > \.optional-surface-switch\s*\{[^}]*position:\s*absolute;[^}]*top:\s*24px;[^}]*right:\s*24px;/s,
    'the closed-surface control must remain in the top-right corner',
  );
  assert.match(
    styles,
    /\.optional-surface-inert\s*\{[^}]*filter:\s*grayscale\(\.72\);[^}]*opacity:\s*\.82;[^}]*pointer-events:\s*none;/s,
    'the closed surface must read as gray and inert',
  );

  for (const source of [header, palette]) {
    assert.match(source, /useOptionalSurface\('token'\)/);
    assert.match(source, /tokenSurface\.enabled/);
  }
  assert.match(palette, /const syms = tokenSurface\.enabled[\s\S]*:\s*\[\]/);
  assert.match(palette, /else if \(tokenSurface\.enabled\) openDetail/);
  assert.match(header, /if \(e\.symbol && !tokenSurface\.enabled\) return/);
});

test('News, Calendar, Markets, and Token own one admitted-state switch in their page toolbar', async () => {
  const [gate, news, calendar, markets, token] = await Promise.all([
    read('components/OptionalSurfaceGate.tsx'),
    read('pages/News.tsx'),
    read('pages/CalendarPage.tsx'),
    read('pages/Markets.tsx'),
    read('pages/TokenDetail.tsx'),
  ]);

  const gateComponentStart = gate.indexOf('export function OptionalSurfaceGate');
  const admittedStart = gate.indexOf('if (input.enabled)', gateComponentStart);
  const closedStart = gate.indexOf('className="optional-surface-gate closed"');
  assert.ok(admittedStart >= 0 && closedStart > admittedStart);
  assert.doesNotMatch(
    gate.slice(admittedStart, closedStart),
    /OptionalSurfaceSwitch/,
    'the generic admitted gate must not duplicate a page-owned switch',
  );
  assert.match(
    gate.slice(closedStart),
    /<OptionalSurfaceSwitch surfaceId=\{surfaceId\} \/>/,
    'an OFF page must retain the recovery switch before its module mounts',
  );

  for (const [surface, source, wrapper] of [
    ['news', news, 'lix-toolbar-tools'],
    ['calendar', calendar, 'lix-toolbar-tools'],
    ['markets', markets, 'mkx-tools'],
    ['token', token, 'tkx-tools'],
  ]) {
    assert.match(
      source,
      /import \{[^}]*\bOptionalSurfaceSwitch\b[^}]*\} from '\.\.\/components\/OptionalSurfaceGate'/,
    );
    const toolbarStart = source.indexOf(`<div className="${wrapper}">`);
    const toolbarEnd = source.indexOf('</header>', toolbarStart);
    assert.ok(toolbarStart >= 0 && toolbarEnd > toolbarStart, `${surface} toolbar is missing`);
    assert.match(
      source.slice(toolbarStart, toolbarEnd),
      new RegExp(`<OptionalSurfaceSwitch surfaceId="${surface}" \/>`),
      `${surface} switch must live in its right-side page toolbar`,
    );
    assert.equal(
      source.split(`<OptionalSurfaceSwitch surfaceId="${surface}" />`).length - 1,
      1,
      `${surface} page must render exactly one admitted-state switch`,
    );
  }
});

test('OFF clears optional enrichment and overlays without disabling passive Opportunities market truth', async () => {
  const [app, header, markets, opportunities, store] = await Promise.all([
    read('App.tsx'),
    read('components/Header.tsx'),
    read('pages/Markets.tsx'),
    read('pages/Opportunities.tsx'),
    read('store.tsx'),
  ]);

  assert.match(markets, /useOptionalSurface\('markets'\)/);
  assert.match(markets, /if \(!marketsSurface\.enabled\)[\s\S]*setEnrichedMarkets\(\[\]\)/);
  assert.match(markets, /'\/api\/markets\/enrichment'/);
  assert.match(markets, /return poll\.stop/);

  // Markets renders one complete source snapshot: lean for every non-current
  // enrichment state, then wholesale enrichment only after current success.
  assert.match(markets, /markets: leanMarkets/);
  assert.match(markets, /marketStatus: leanMarketStatus/);
  assert.match(markets, /marketsLastSuccessAtMs: leanMarketsLastSuccessAtMs/);
  assert.match(
    markets,
    /const enrichmentCurrent = marketsSurface\.enabled\s*&& enrichmentStatus === 'CURRENT'\s*&& enrichmentLastSuccessAtMs !== null/,
  );
  assert.match(
    markets,
    /const markets = !marketsSurface\.enabled\s*\? \[\]\s*:\s*enrichmentCurrent\s*\? enrichedMarkets\s*:\s*leanMarkets/,
  );
  assert.match(markets, /const marketStatus = enrichmentCurrent \? 'CURRENT' : leanMarketStatus/);
  assert.match(
    markets,
    /const marketsLastSuccessAtMs = enrichmentCurrent\s*\? enrichmentLastSuccessAtMs\s*:\s*leanMarketsLastSuccessAtMs/,
  );
  for (const state of ['LOADING', 'STALE', 'UNAVAILABLE']) {
    assert.match(markets, new RegExp(`enrichmentStatus === '${state}'|Enrichment ${state[0]}${state.slice(1).toLowerCase()}`));
  }
  const selectionStart = markets.indexOf('const enrichmentCurrent =');
  const selectionEnd = markets.indexOf('const watchlist =', selectionStart);
  assert.ok(selectionStart >= 0 && selectionEnd > selectionStart, 'market snapshot selector is missing');
  const selection = markets.slice(selectionStart, selectionEnd);
  assert.doesNotMatch(selection, /\.\.\.|Object\.assign|\.map\(|\.reduce\(|\.find\(/, 'lean and enrichment rows must never be field-merged');

  // The lean passive cut is intentionally retained for Opportunities, which
  // never imports, fetches, or projects the optional enrichment dataset.
  assert.match(store, /fetchJson\('\/api\/markets', \{ signal \}\)/);
  assert.doesNotMatch(store, /\/api\/markets\/enrichment/);
  assert.match(app, /page === 'opportunities' && <Opportunities \/>/);
  assert.match(opportunities, /useStore\(\)/);
  assert.doesNotMatch(opportunities, /\/api\/markets\/enrichment|enrichedMarkets|MarketEnrichmentResponse/);

  const overlaysStart = header.indexOf('export function Overlays()');
  const overlaysEnd = header.indexOf('export function BottomNav()', overlaysStart);
  const overlays = header.slice(overlaysStart, overlaysEnd);
  assert.match(overlays, /optionalSurfaceAllowsOverlay\(optionalSurfaces, kind\)/);
  assert.match(overlays, /if \(kind !== null && !allowed\) set\(null\)/);
  assert.match(overlays, /if \(!allowed\) return null/);
  assert.doesNotMatch(overlays, /<OptionalSurfaceGate/, 'OFF must clear an overlay, not replace it with another modal');
});

test('Token News polling follows authoritative News admission and stops while News is OFF', async () => {
  const detail = await read('pages/TokenDetail.tsx');
  const newsOwnerMatch = detail.match(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*useOptionalSurface\(\s*['"]news['"]\s*\)/,
  );
  assert.ok(newsOwnerMatch, 'TokenDetail must consume the authoritative News optional-surface owner');

  const newsOwner = newsOwnerMatch[1];
  const newsEffectStart = detail.lastIndexOf('useEffect(() => {', detail.indexOf('/api/news-context?limit=220'));
  const newsEffectEnd = detail.indexOf('\n  const points = useMemo', newsEffectStart);
  assert.ok(newsEffectStart >= 0 && newsEffectEnd > newsEffectStart, 'Token News effect boundary is missing');
  const newsEffect = detail.slice(newsEffectStart, newsEffectEnd);

  const offGuardAt = newsEffect.search(new RegExp(`if\\s*\\(\\s*!${newsOwner}\\.enabled\\s*\\)`));
  const pollAt = newsEffect.indexOf('createSettledPoll<TokenNewsContext>');
  assert.ok(offGuardAt >= 0, 'News OFF must guard Token News polling');
  assert.ok(pollAt > offGuardAt, 'News admission must be checked before the Token News poll is created');
  assert.match(newsEffect, /setNewsContext\(null\)/);
  assert.match(newsEffect, /return poll\.stop/);
  assert.match(
    newsEffect,
    new RegExp(`\\[[^\\]]*${newsOwner}\\.enabled[^\\]]*\\]`),
    'an authoritative News state transition must tear down and re-evaluate the poll effect',
  );
});

test('Volume exact-symbol intelligence follows authoritative Token admission and stops while Token is OFF', async () => {
  const volume = await read('pages/VolumeScanner.tsx');
  const tokenOwnerMatch = volume.match(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*useOptionalSurface\(\s*['"]token['"]\s*\)/,
  );
  assert.ok(tokenOwnerMatch, 'Volume must consume the authoritative Token optional-surface owner');

  const tokenOwner = tokenOwnerMatch[1];
  const intelligenceEffectStart = volume.lastIndexOf(
    'useEffect(() => {',
    volume.indexOf('/api/intelligence/token?symbol='),
  );
  const intelligenceEffectEnd = volume.indexOf('\n\n  const volumeComponent =', intelligenceEffectStart);
  assert.ok(
    intelligenceEffectStart >= 0 && intelligenceEffectEnd > intelligenceEffectStart,
    'Volume exact-symbol intelligence effect boundary is missing',
  );
  const intelligenceEffect = volume.slice(intelligenceEffectStart, intelligenceEffectEnd);

  const clearAt = intelligenceEffect.indexOf('setExpandedIntelligence(null)');
  const offGuardAt = intelligenceEffect.search(
    new RegExp(`if\\s*\\([^)]*!${tokenOwner}\\.enabled\\s*\\)\\s*return`),
  );
  const pollAt = intelligenceEffect.indexOf('createSettledPoll<TokenIntelligenceRead>');
  assert.ok(clearAt >= 0, 'Token OFF must clear retained Volume intelligence');
  assert.ok(offGuardAt > clearAt, 'retained intelligence must clear before the Token OFF return');
  assert.ok(pollAt > offGuardAt, 'Token admission must be checked before the Volume intelligence poll is created');
  assert.match(intelligenceEffect, /setExpandedIntelligenceError\(expanded === null \? null : tokenIntelligenceAdmissionError\)/);
  assert.match(intelligenceEffect, /return poll\.stop/);
  assert.match(
    intelligenceEffect,
    new RegExp(`\\[[^\\]]*${tokenOwner}\\.enabled[^\\]]*${tokenOwner}\\.snapshot\\.generation[^\\]]*\\]`),
    'Token state or generation transitions must tear down and re-evaluate the Volume intelligence poll',
  );
  assert.match(volume, /tokenIntelligenceAdmissionPending\s*=\s*tokenSurface\.controlStatus === 'LOADING'/);
  assert.match(volume, /tokenIntelligenceAdmissionPending[\s\S]*?'ADMISSION PENDING'/);
  assert.match(volume, /No exact-symbol owner request is mounted until control truth is current\./);
});

test('Markets admission cannot awaken TokenIcon demand, and requester release retires it', async (t) => {
  const priorFetch = globalThis.fetch;
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const priorWindow = globalThis.window;
  const requests = [];
  globalThis.window = globalThis;
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    const bases = new URL(url, 'http://local.test').searchParams.get('bases')?.split(',') ?? [];
    return new Response(JSON.stringify(Object.fromEntries(
      bases.map((base) => [base, `https://icons.invalid/${base}.png`]),
    )), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const releaseSubscription = onIcons(() => {});
  const releaseCoreIcon = requestIcon('COREICON');
  t.after(() => {
    releaseCoreIcon();
    releaseSubscription();
    setIconManifestAdmission('token', false, 2);
    setIconManifestAdmission('markets', false, 2);
    if (priorFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = priorFetch;
    if (hadWindow) globalThis.window = priorWindow;
    else delete globalThis.window;
  });

  setIconManifestAdmission('markets', true, 1);
  await new Promise((resolve) => setTimeout(resolve, 325));
  assert.deepEqual(requests, [], 'Markets ON must not admit retained core TokenIcon demand');

  const releaseMarketIcon = requestIcon('MARKETICON', 'markets');
  await new Promise((resolve) => setTimeout(resolve, 325));
  assert.equal(requests.length, 1);
  assert.match(requests[0], /bases=MARKETICON(?:&|$)/);
  assert.doesNotMatch(requests[0], /COREICON/);

  releaseMarketIcon();
  releaseMarketIcon();
  releaseCoreIcon();
  releaseCoreIcon();
  const settledRequestCount = requests.length;
  setIconManifestAdmission('token', true, 1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    requests.length,
    settledRequestCount,
    'released requester demand must not revive when its owner is later admitted',
  );
});

test('Markets base-set refresh preserves prime demand and only changed sets reacquire it', async (t) => {
  const markets = await read('pages/Markets.tsx');
  const identityStart = markets.indexOf('function iconBaseSetIdentity(');
  const identityEnd = markets.indexOf('\n}\n', identityStart);
  assert.ok(identityStart >= 0 && identityEnd > identityStart, 'Markets base-set identity owner is missing');
  const identityOwner = markets.slice(identityStart, identityEnd + 2);
  assert.match(identityOwner, /\.map\(\(market\) => market\.base\.trim\(\)\.toUpperCase\(\)\)/);
  assert.match(identityOwner, /\.filter\(\(base\) => ICON_BASE_PATTERN\.test\(base\)\)/);
  assert.match(identityOwner, /return \[\.\.\.new Set\(bases\)\]\.sort\(\)\.join\(ICON_BASE_SEPARATOR\)/);

  const primeDependencyAt = markets.indexOf(
    'const iconBasesIdentity = useMemo(() => iconBaseSetIdentity(markets), [markets]);',
  );
  const nextEffectAt = markets.indexOf('\n  useEffect(() => {', primeDependencyAt);
  assert.ok(primeDependencyAt >= 0 && nextEffectAt > primeDependencyAt, 'Markets icon prime effect is missing');
  const primeEffect = markets.slice(primeDependencyAt, nextEffectAt);
  const primeEffectOnly = primeEffect.slice(primeEffect.indexOf('useEffect('));
  assert.match(
    primeEffect,
    /primeIcons\(iconBasesIdentity \? iconBasesIdentity\.split\(ICON_BASE_SEPARATOR\) : \[\]\)/,
  );
  assert.match(
    primeEffect,
    /\[iconBasesIdentity\],\s*\);/,
    'Markets icon demand must react to the canonical base set, not refreshed array identity',
  );
  assert.doesNotMatch(primeEffectOnly, /\[markets\]/, 'raw market snapshot identity must not reset prime demand');

  const priorFetch = globalThis.fetch;
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const priorWindow = globalThis.window;
  const requests = [];
  globalThis.window = globalThis;
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const canonicalIdentity = (rows) => [...new Set(rows
    .map(({ base }) => base.trim().toUpperCase())
    .filter((base) => /^[A-Z0-9\u3400-\u9fff]{1,24}$/u.test(base)))]
    .sort()
    .join(',');
  let previousIdentity;
  let releasePrime = null;
  const renderMarketsSnapshot = (rows) => {
    const nextIdentity = canonicalIdentity(rows);
    if (previousIdentity !== undefined && Object.is(previousIdentity, nextIdentity)) return;
    releasePrime?.();
    releasePrime = primeIcons(nextIdentity ? nextIdentity.split(',') : []);
    previousIdentity = nextIdentity;
  };

  const releaseSubscription = onIcons(() => {});
  t.after(() => {
    releasePrime?.();
    releaseSubscription();
    setIconManifestAdmission('markets', false, 4);
    if (priorFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = priorFetch;
    if (hadWindow) globalThis.window = priorWindow;
    else delete globalThis.window;
  });

  setIconManifestAdmission('markets', true, 3);
  renderMarketsSnapshot([{ base: 'STABLEALPHA' }, { base: 'STABLEBETA' }]);
  await new Promise((resolve) => setTimeout(resolve, 325));
  assert.equal(requests.length, 1);
  assert.match(requests[0], /bases=STABLEALPHA%2CSTABLEBETA(?:&|$)/);

  renderMarketsSnapshot([{ base: ' stablebeta ' }, { base: 'stablealpha' }]);
  await new Promise((resolve) => setTimeout(resolve, 325));
  assert.equal(
    requests.length,
    1,
    'an equivalent refreshed base set must retain demand and its existing retry budget',
  );

  renderMarketsSnapshot([{ base: 'STABLEALPHA' }, { base: 'STABLEGAMMA' }]);
  await new Promise((resolve) => setTimeout(resolve, 325));
  assert.equal(requests.length, 2, 'a changed base set must release and reacquire Markets demand');
  assert.match(requests[1], /bases=STABLEALPHA%2CSTABLEGAMMA(?:&|$)/);
  assert.doesNotMatch(requests[1], /STABLEBETA/, 'released bases must not remain in reacquired demand');
});

test('icon batches carry one admitted owner without cross-owner demand fallthrough or overlap duplication', async (t) => {
  const priorFetch = globalThis.fetch;
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const priorWindow = globalThis.window;
  const requests = [];
  globalThis.window = globalThis;
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const releaseSubscription = onIcons(() => {});
  const releaseTokenOnly = requestIcon('OWNERTOKEN', 'token');
  const releaseMarketOnly = requestIcon('OWNERMARKET', 'markets');
  const releaseOverlapToken = requestIcon('OWNEROVERLAP', 'token');
  const releaseOverlapMarket = requestIcon('OWNEROVERLAP', 'markets');
  t.after(() => {
    setIconManifestAdmission('token', false, 12);
    setIconManifestAdmission('markets', false, 12);
    releaseTokenOnly();
    releaseMarketOnly();
    releaseOverlapToken();
    releaseOverlapMarket();
    releaseSubscription();
    if (priorFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = priorFetch;
    if (hadWindow) globalThis.window = priorWindow;
    else delete globalThis.window;
  });

  const decodeBatch = (value) => {
    const url = new URL(value, 'http://local.test');
    return {
      owner: url.searchParams.get('owner'),
      bases: new Set(url.searchParams.get('bases')?.split(',') ?? []),
    };
  };

  setIconManifestAdmission('token', true, 10);
  setIconManifestAdmission('markets', true, 10);
  await new Promise((resolve) => setTimeout(resolve, 325));

  assert.equal(requests.length, 2, 'each admitted owner must receive one explicit disjoint batch');
  const initialBatches = requests.map(decodeBatch);
  const tokenBatch = initialBatches.find((batch) => batch.owner === 'token');
  const marketsBatch = initialBatches.find((batch) => batch.owner === 'markets');
  assert.ok(tokenBatch, 'Token icon demand must use an explicit Token batch');
  assert.ok(marketsBatch, 'Markets icon demand must use an explicit Markets batch');
  assert.deepEqual(tokenBatch.bases, new Set(['OWNERTOKEN', 'OWNEROVERLAP']));
  assert.deepEqual(marketsBatch.bases, new Set(['OWNERMARKET']));
  assert.equal(
    initialBatches.filter((batch) => batch.bases.has('OWNEROVERLAP')).length,
    1,
    'an overlapping base must consume retry work in exactly one owner batch',
  );

  setIconManifestAdmission('token', false, 11);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(requests.length, 3);
  const fallbackBatch = decodeBatch(requests[2]);
  assert.equal(fallbackBatch.owner, 'markets');
  assert.deepEqual(fallbackBatch.bases, new Set(['OWNERMARKET', 'OWNEROVERLAP']));
  assert.equal(
    fallbackBatch.bases.has('OWNERTOKEN'),
    false,
    'Token-only demand must never fall through Markets admission',
  );

  const settledRequestCount = requests.length;
  setIconManifestAdmission('token', true, 10);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    requests.length,
    settledRequestCount,
    'a lower generation must not reopen owner admission or reset retry work',
  );

  const icons = await read('lib/iconManifest.ts');
  assert.match(icons, /if \(canonicalGeneration < current\.generation\) return;/);
  assert.match(
    icons,
    /`\/api\/icons\?owner=\$\{encodeURIComponent\(batch\.owner\)\}&bases=\$\{encodeURIComponent\(batch\.bases\.join\(','\)\)\}`/,
  );
  assert.match(icons, /const OWNER_ORDER: readonly IconManifestOwner\[\] = \['token', 'markets'\]/);
  assert.match(icons, /const selected = \[\.\.\.unresolved\][\s\S]*\.slice\(0, MAX_BATCH_SIZE\)/);
});

test('TokenIcon and Markets register separate releasable icon demand owners', async () => {
  const [control, icons, tokenIcon] = await Promise.all([
    read('components/OptionalSurfaceGate.tsx'),
    read('lib/iconManifest.ts'),
    read('components/TokenIcon.tsx'),
  ]);

  assert.match(icons, /export type IconManifestOwner = 'token' \| 'markets'/);
  assert.match(icons, /const demand = new Map<string, Record<IconManifestOwner, number>>\(\)/);
  assert.match(icons, /function baseWorkAdmitted\(base: string\): boolean/);
  assert.match(icons, /admission\.token\.enabled && counts\.token > 0/);
  assert.match(icons, /admission\.markets\.enabled && counts\.markets > 0/);
  assert.match(icons, /if \(!manifest(?:Retry|Work)Admitted\(\) \|\| flushTimer !== null\) return/);
  assert.match(icons, /activeQuery\?\.abort\(\)/);
  assert.match(icons, /export function requestIcon\([^)]*owner:[^)]*'token'[^)]*\): \(\) => void/);
  assert.match(icons, /counts\[owner\] \+= 1/);
  assert.match(icons, /current\[owner\] = Math\.max\(0, current\[owner\] - 1\)/);
  assert.match(icons, /export function primeIcons\(bases: string\[\]\): \(\) => void/);
  assert.match(icons, /requestIcon\(base, 'markets'\)/);
  assert.match(icons, /for \(const release of releases\) release\(\)/);

  assert.match(tokenIcon, /const releaseIcon = requestIcon\(base\)/);
  assert.match(tokenIcon, /const unsubscribe = onIcons\(force\)/);
  assert.match(tokenIcon, /return \(\) => \{[\s\S]*unsubscribe\(\)[\s\S]*releaseIcon\(\)[\s\S]*\}/);

  assert.match(control, /const tokenEnabled = optionalSurfaceEnabled\(state, 'token'\)/);
  assert.match(control, /const marketsEnabled = optionalSurfaceEnabled\(state, 'markets'\)/);
  assert.match(control, /setIconManifestAdmission\('token', tokenEnabled, token\.generation\)/);
  assert.match(control, /setIconManifestAdmission\('markets', marketsEnabled, markets\.generation\)/);
  assert.doesNotMatch(control, /tokenEnabled \|\| marketsEnabled/);
  assert.match(control, /fetchJsonResponse<OptionalSurfaceMutationResponse>\(/);
  assert.match(control, /12_000,\s*\[503\]/);
  assert.match(control, /return result\.snapshot\.phase !== 'FAILED'/);
});
