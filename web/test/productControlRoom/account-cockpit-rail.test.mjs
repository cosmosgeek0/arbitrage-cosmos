import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  INITIAL_PRIVATE_READ_APPLIED_TRUTH,
  PRIVATE_READ_ACCESS_DENIED_REASON,
  PRIVATE_READ_AUTH_REQUIRED_REASON,
  PRIVATE_READ_STALE_AFTER_MS,
  decodePrivateReadSnapshot,
  privateReadAccessReasonForStatus,
  privateReadErrorFact,
  reducePrivateReadAppliedTruth,
  unavailablePrivateRead,
} from '../../src/lib/privateRead.ts';
import {
  AccountCockpitRailView,
  accountCockpitCountFact,
  accountCockpitScrollTarget,
} from '../../src/components/AccountCockpitRailView.tsx';

// The shared runner has no root tsconfig, so its TSX loader may use the classic
// JSX transform for house components.
globalThis.React = React;

const SOURCE_ROOT = fileURLToPath(new URL('../../src/', import.meta.url));
const read = (relativePath) => readFile(join(SOURCE_ROOT, relativePath), 'utf8');

/** The actual top-level sidebar routes this cockpit must cover. */
const TOP_LEVEL_ROUTE_LABELS = [
  'Dashboard', 'Account', 'Borrow', 'Markets', 'Token', 'Basis', 'Volume',
  'Opportunities', 'Control Room', 'Risk', 'Health', 'Logs', 'News',
  'Calendar', 'Notifications',
];

/** Every internal Account view the shell routes to the same page component. */
const ACCOUNT_VIEW_ROUTES = ['wallets', 'execution', 'orders', 'positions', 'fills', 'pnl'];

async function sourceInventory(directory = SOURCE_ROOT) {
  const rows = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...await sourceInventory(absolute));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      rows.push({ path: relative(SOURCE_ROOT, absolute), source: await readFile(absolute, 'utf8') });
    }
  }
  return rows;
}

function coverage(state = 'COMPLETE_CURRENT', limitation = null) {
  return { state, symbols: [], limitation };
}

function verifiedPosture(observedAt) {
  return {
    state: 'VERIFIED_READ_ONLY',
    observedAt,
    keyLabel: 'Binance Owner Read',
    keyLast4: 'A1B2',
    reading: true,
    spotMarginTrading: false,
    margin: false,
    futures: false,
    withdrawals: false,
    internalTransfer: false,
    universalTransfer: false,
    ipRestricted: true,
    fixTrade: false,
    portfolioMarginTrading: false,
    vanillaOptions: false,
    fixReadOnly: false,
  };
}

/**
 * An admitted read whose collections are exact empty arrays: the one shape that
 * proves an observed zero, as opposed to an unavailable read's `null`.
 */
function exactEmptyFixture(observedAt) {
  return {
    schemaVersion: 'binance.private-read.v1',
    state: 'AVAILABLE',
    observedAt,
    permissionPosture: verifiedPosture(observedAt),
    spot: {
      state: 'AVAILABLE',
      observedAt,
      balances: [{ asset: 'USDT', free: '12.50000000', locked: '0.00000000' }],
      openOrders: [],
      fills: [],
      coverage: coverage(),
    },
    margin: {
      state: 'AVAILABLE',
      observedAt,
      totalAssetBtc: '0.10000000',
      totalLiabilityBtc: '0.00000000',
      totalNetAssetBtc: '0.10000000',
      assets: [],
      openOrders: [],
      fills: [],
      coverage: coverage(),
    },
    usdm: {
      state: 'AVAILABLE',
      observedAt,
      balances: [],
      positions: [],
      openOrders: [],
      fills: [],
      coverage: coverage(),
    },
    reconciliation: {
      balances: { state: 'PARTIAL', observedAt, reason: 'No independent balance invariant is computed.' },
      orders: { state: 'PARTIAL', observedAt, reason: 'No independent order invariant is computed.' },
      fills: { state: 'PARTIAL', observedAt, reason: 'No independent fill invariant is computed.' },
      positions: { state: 'PARTIAL', observedAt, reason: 'No independent position invariant is computed.' },
      liabilities: { state: 'RECONCILED', observedAt, reason: null },
    },
  };
}

/** A configured key whose observed permissions contradict a read-only claim. */
function unsafePostureFixture(observedAt) {
  const unavailable = { state: 'UNAVAILABLE', observedAt: null, reason: 'PRIVATE_READ_UNAVAILABLE' };
  const product = {
    state: 'UNAVAILABLE',
    observedAt: null,
    coverage: coverage('UNAVAILABLE', 'PRIVATE_READ_UNAVAILABLE'),
  };
  return {
    schemaVersion: 'binance.private-read.v1',
    state: 'UNAVAILABLE',
    observedAt: null,
    permissionPosture: { ...verifiedPosture(observedAt), state: 'UNSAFE', withdrawals: true },
    spot: { ...product, balances: null, openOrders: null, fills: null },
    margin: {
      ...product,
      totalAssetBtc: null,
      totalLiabilityBtc: null,
      totalNetAssetBtc: null,
      assets: null,
      openOrders: null,
      fills: null,
    },
    usdm: { ...product, balances: null, positions: null, openOrders: null, fills: null },
    reconciliation: {
      balances: { ...unavailable },
      orders: { ...unavailable },
      fills: { ...unavailable },
      positions: { ...unavailable },
      liabilities: { ...unavailable },
    },
  };
}

function notConfiguredFixture() {
  const product = {
    state: 'NOT_CONFIGURED',
    observedAt: null,
    coverage: coverage('NOT_CONFIGURED'),
  };
  const fact = { state: 'NOT_CONFIGURED', observedAt: null, reason: null };
  return {
    schemaVersion: 'binance.private-read.v1',
    state: 'NOT_CONFIGURED',
    observedAt: null,
    permissionPosture: {
      state: 'NOT_CONFIGURED',
      observedAt: null,
      keyLabel: 'Binance Private Read',
      keyLast4: null,
      reading: null,
      spotMarginTrading: null,
      margin: null,
      futures: null,
      withdrawals: null,
      internalTransfer: null,
      universalTransfer: null,
      ipRestricted: null,
      fixTrade: null,
      portfolioMarginTrading: null,
      vanillaOptions: null,
      fixReadOnly: null,
    },
    spot: { ...product, balances: null, openOrders: null, fills: null },
    margin: {
      ...product,
      totalAssetBtc: null,
      totalLiabilityBtc: null,
      totalNetAssetBtc: null,
      assets: null,
      openOrders: null,
      fills: null,
    },
    usdm: { ...product, balances: null, positions: null, openOrders: null, fills: null },
    reconciliation: {
      balances: { ...fact },
      orders: { ...fact },
      fills: { ...fact },
      positions: { ...fact },
      liabilities: { ...fact },
    },
  };
}

/** Only a contract-valid snapshot may reach the cockpit. */
function admitted(fixture) {
  const decoded = decodePrivateReadSnapshot(fixture);
  assert.ok(decoded, 'fixture must satisfy the private-read contract');
  return decoded;
}

function render(snapshot, source = 'STATE', error = null) {
  return renderToStaticMarkup(
    React.createElement(AccountCockpitRailView, { snapshot, source, error }),
  );
}

function factCell(html, id) {
  const match = html.match(new RegExp(`<div class="acr-fact" data-acr-fact="${id}"[\\s\\S]*?</div>`));
  assert.ok(match, `the cockpit must render the ${id} fact`);
  return match[0];
}

function attribute(html, name) {
  const match = html.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] ?? null;
}

test('the shell mounts one shared cockpit ahead of the route, covering every actual top-level route', async () => {
  const [app, header] = await Promise.all([read('App.tsx'), read('components/Header.tsx')]);

  // Exactly one mount, inside the shell's route main and before the route frame.
  assert.equal((app.match(/<AccountCockpitRail \/>/g) ?? []).length, 1);
  const mountIndex = app.indexOf('<AccountCockpitRail />');
  const mainIndex = app.indexOf('<main ref={mainRef}');
  const frameIndex = app.indexOf('className={`app-page-frame');
  const boundaryIndex = app.indexOf('<ErrorBoundary');
  assert.ok(mainIndex >= 0 && frameIndex > mainIndex);
  assert.ok(mountIndex > mainIndex, 'the cockpit mounts inside the shared route main');
  assert.ok(mountIndex < frameIndex, 'the cockpit mounts before the route frame');
  assert.ok(mountIndex < boundaryIndex, 'the cockpit mounts before the route content');
  assert.match(app, /<StoreProvider>[\s\S]*<Shell \/>[\s\S]*<\/StoreProvider>/);

  // The sidebar's real routes are exactly the surfaces the cockpit must cover.
  const navStart = header.indexOf('const NAV:');
  assert.ok(navStart >= 0);
  const navBlock = header.slice(navStart, header.indexOf('\n];', navStart));
  const navItems = [...navBlock.matchAll(/\{ id: '([a-z-]+)', label: '([^']+)'/g)];
  assert.deepEqual(navItems.map(([, , label]) => label), TOP_LEVEL_ROUTE_LABELS);

  // Every one of them, and every internal Account view, renders after the mount.
  const routeIds = [...navItems.map(([, id]) => id), ...ACCOUNT_VIEW_ROUTES];
  assert.equal(new Set(routeIds).size, TOP_LEVEL_ROUTE_LABELS.length + ACCOUNT_VIEW_ROUTES.length);
  // Searched from the shared frame so a shell expression such as the
  // `framePage` guard can never stand in for a real route branch.
  for (const id of routeIds) {
    const routeIndex = app.indexOf(`page === '${id}'`, frameIndex);
    assert.ok(routeIndex > frameIndex, `App must route ${id} inside the shared frame`);
    assert.ok(mountIndex < routeIndex, `the cockpit must precede the ${id} route`);
  }

  // No route repeats the cockpit: the shell is its only owner.
  for (const { path, source } of await sourceInventory()) {
    if (path === 'App.tsx' || path.startsWith('components/AccountCockpitRail')) continue;
    assert.equal(
      source.includes('AccountCockpitRail'),
      false,
      `${path} must not mount a second account cockpit`,
    );
  }
});

test('the cockpit is a labelled complementary landmark with semantic facts and no money control', () => {
  const html = render(admitted(exactEmptyFixture(Date.now())));

  assert.equal((html.match(/<aside\b/g) ?? []).length, 1);
  assert.match(html, /<aside class="acr-rail" aria-label="Account cockpit" data-account-cockpit-rail="mounted"/);
  assert.equal((html.match(/<dl class="acr-facts" tabindex="0" aria-label="Account facts">/g) ?? []).length, 1);
  assert.equal((html.match(/<div class="acr-fact"/g) ?? []).length, 12);
  assert.equal((html.match(/<dt>/g) ?? []).length, 12);
  assert.equal((html.match(/<dd>/g) ?? []).length, 12);

  // The four highest-priority facts lead the DOM, so the narrow column flow
  // shows them without scrolling.
  assert.deepEqual(
    [...html.matchAll(/data-acr-fact="([a-z-]+)"/g)].map(([, id]) => id).slice(0, 4),
    ['private-read', 'freshness', 'permission', 'admission'],
  );

  // No control and no navigation. The one tab stop is the scrollable fact
  // canvas itself, which must stay reachable by keyboard.
  assert.doesNotMatch(html, /<button|<a\s|<input|<select|<textarea|<form/i);
  assert.doesNotMatch(html, /contenteditable|role="button"|role="link"|href=/i);
  assert.equal((html.match(/tabindex="[^"]*"/g) ?? []).length, 1);
  assert.match(html, /<dl [^>]*tabindex="0"/);
  // Future actions are an unmistakably inert status, never a decorative control.
  assert.match(html, /data-acr-actions="PLANNED_DISABLED"/);
  assert.match(html, /Planned · Disabled/);
  assert.doesNotMatch(html, /\b(?:Trade|Cancel|Borrow now|Repay|Transfer|Withdraw)\b/);
});

test('the pure scroll target advances only through its synthetic horizontal range', async () => {
  // Synthetic geometry exercises the navigation math only. Responsive layout,
  // focus visibility, and event cancellation are proved separately in a real
  // rendered browser by the integration owner.
  const canvas = { scrollLeft: 0, clientWidth: 295, scrollWidth: 989 };
  const maximum = canvas.scrollWidth - canvas.clientWidth;

  // One visible canvas forward, then clamped at the last column.
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'ArrowRight' }), 295);
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'PageDown', scrollLeft: 295 }), 590);
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'ArrowRight', scrollLeft: 590 }), maximum);

  // One visible canvas back, then clamped at the start.
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'ArrowLeft', scrollLeft: maximum }), 399);
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'PageUp', scrollLeft: 399 }), 104);
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'ArrowLeft', scrollLeft: 104 }), 0);

  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'Home', scrollLeft: maximum }), 0);
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'End' }), maximum);

  // The handler belongs to the labelled canvas itself; no control is added.
  const view = await read('components/AccountCockpitRailView.tsx');
  assert.match(view, /<dl className="acr-facts" tabIndex=\{0\} aria-label="Account facts" onKeyDown=\{scrollFactCanvas\}>/);
  assert.equal((view.match(/onKeyDown=/g) ?? []).length, 1);
  assert.match(view, /if \(target === null\) return;\s*event\.preventDefault\(\);\s*canvas\.scrollLeft = target;/);
  assert.doesNotMatch(view, /behavior: 'smooth'|scrollIntoView|scrollBy\(/);
  assert.doesNotMatch(view, /onClick|<button/);
});

test('no-movement keys stay native at boundaries, without overflow, and with invalid geometry', () => {
  const canvas = { scrollLeft: 0, clientWidth: 295, scrollWidth: 989 };
  const maximum = canvas.scrollWidth - canvas.clientWidth;

  // Recognized navigation is not swallowed when it cannot move the canvas.
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'ArrowLeft' }), null);
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'Home' }), null);
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'ArrowRight', scrollLeft: maximum }), null);
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'End', scrollLeft: maximum }), null);

  // Unrecognized keys keep their native behaviour.
  for (const key of ['ArrowDown', 'ArrowUp', 'Tab', 'Enter', ' ', 'a', 'Escape']) {
    assert.equal(accountCockpitScrollTarget({ ...canvas, key }), null, `${key} must stay native`);
  }

  // Untrusted or non-scrollable measurements fail closed to native behaviour.
  for (const broken of [
    { clientWidth: Number.NaN, scrollWidth: 989 },
    { clientWidth: 295, scrollWidth: Number.NaN },
    { clientWidth: 295, scrollWidth: Number.POSITIVE_INFINITY },
    { clientWidth: 989, scrollWidth: 989 },
    { clientWidth: 1_000, scrollWidth: 989 },
    { clientWidth: 0, scrollWidth: 989 },
    { clientWidth: -1, scrollWidth: 989 },
  ]) {
    assert.equal(accountCockpitScrollTarget({ scrollLeft: 0, key: 'ArrowRight', ...broken }), null);
    assert.equal(accountCockpitScrollTarget({ scrollLeft: 0, key: 'End', ...broken }), null);
  }
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'ArrowRight', scrollLeft: Number.NaN }), null);
  assert.equal(accountCockpitScrollTarget({ ...canvas, key: 'ArrowRight', scrollLeft: Number.NEGATIVE_INFINITY }), null);
});

test('the cockpit consumes the existing store and projector without a transport of its own', async () => {
  const [rail, view] = await Promise.all([
    read('components/AccountCockpitRail.tsx'),
    read('components/AccountCockpitRailView.tsx'),
  ]);

  assert.match(rail, /const \{ privateRead, privateReadSource, privateReadError \} = useStore\(\);/);
  assert.match(rail, /<AccountCockpitRailView/);
  assert.match(view, /projectPrivateRead\(snapshot\)/);
  assert.match(view, /exactOrDash\(/);
  // The presentation surface never reaches the store itself, so the shell stays
  // the single consumption point.
  assert.doesNotMatch(view, /useStore|from '\.\.\/store'/);

  for (const source of [rail, view]) {
    assert.doesNotMatch(source, /\bfetch\s*\(|fetchJson|XMLHttpRequest|EventSource|new WebSocket|navigator\.sendBeacon/);
    assert.doesNotMatch(source, /useEffect|useLayoutEffect|useState|useRef|createSettledPoll/);
    assert.doesNotMatch(source, /setInterval|setTimeout|requestAnimationFrame|queueMicrotask/);
    assert.doesNotMatch(source, /'\/api\//);
    assert.doesNotMatch(source, /Date\.now\(\)|new Date\(/);
  }
});

test('one preferred private read and one bounded fallback remain the only private transports', async () => {
  const inventory = await sourceInventory();
  const fallbackOwners = inventory.filter(({ source }) => source.includes('/api/private-account'));
  assert.deepEqual(fallbackOwners.map(({ path }) => path), ['store.tsx']);

  const store = await read('store.tsx');
  assert.equal((store.match(/\/api\/private-account/g) ?? []).length, 1);
  assert.equal((store.match(/createSettledPoll<unknown>/g) ?? []).length, 1);
  assert.match(store, /if \(privateReadSource !== 'FALLBACK'\) return;/);
  assert.match(store, /if \(privateReadSource === 'FALLBACK'\) return;/);
});

test('a null collection stays unknown and an exact empty array keeps its observed zero', () => {
  assert.deepEqual(accountCockpitCountFact(null, 'UNAVAILABLE'), {
    value: '—',
    status: 'UNKNOWN',
    detail: 'UNKNOWN · absence is not counted as zero.',
    tone: 'warn',
  });
  assert.equal(accountCockpitCountFact(null, 'NOT_CONFIGURED').status, 'NOT_CONFIGURED');
  assert.equal(accountCockpitCountFact(null, 'NOT_CONFIGURED').value, '—');
  assert.equal(accountCockpitCountFact(0, 'AVAILABLE').value, '0');
  assert.equal(accountCockpitCountFact(0, 'AVAILABLE').status, 'EXACT_EMPTY');
  assert.equal(accountCockpitCountFact(4, 'AVAILABLE').value, '4');

  const exact = render(admitted(exactEmptyFixture(Date.now())));
  for (const id of ['open-orders', 'fills', 'positions', 'liabilities']) {
    const cell = factCell(exact, id);
    assert.match(cell, /<b class="s-ok">0<\/b>/, `${id} must present its observed zero`);
    assert.match(cell, /EXACT_EMPTY/);
    assert.doesNotMatch(cell, /—/);
  }
  assert.match(factCell(exact, 'spot-available-usdt'), /<b class="s-ok">12\.50000000<\/b>/);

  const unknown = render(unavailablePrivateRead('PRIVATE_READ_REQUEST_FAILED'), 'FALLBACK');
  for (const id of ['open-orders', 'fills', 'positions', 'liabilities', 'spot-available-usdt']) {
    const cell = factCell(unknown, id);
    assert.match(cell, /—/, `${id} must stay an em dash when nothing was admitted`);
    assert.match(cell, /UNKNOWN/);
    assert.doesNotMatch(cell, /<b[^>]*>0<\/b>/, `${id} must never fabricate a zero`);
  }
});

test('a 401 is application authentication required with provider state unknown', () => {
  assert.equal(privateReadAccessReasonForStatus(401), PRIVATE_READ_AUTH_REQUIRED_REASON);
  assert.equal(privateReadAccessReasonForStatus(500), null);
  assert.equal(privateReadAccessReasonForStatus('401'), null);
  const authentication = privateReadErrorFact(PRIVATE_READ_AUTH_REQUIRED_REASON);
  assert.equal(authentication.id, 'AUTH_REQUIRED');
  assert.equal(authentication.label, 'AUTH REQUIRED');
  assert.equal(authentication.tone, 'bad');
  assert.equal(authentication.guardTone, 'bad');
  assert.match(authentication.detail, /Application authentication is required/);
  assert.match(authentication.detail, /provider state is UNKNOWN/);
  assert.doesNotMatch(authentication.detail, /provider (?:refused|denied|rejected|requires authentication)/i);

  const html = render(
    unavailablePrivateRead(PRIVATE_READ_AUTH_REQUIRED_REASON),
    'STATE',
    PRIVATE_READ_AUTH_REQUIRED_REASON,
  );
  assert.equal(attribute(html, 'data-acr-error'), PRIVATE_READ_AUTH_REQUIRED_REASON);
  assert.equal(attribute(html, 'data-acr-tone'), 'bad');
  assert.equal(attribute(html, 'data-acr-state'), 'UNAVAILABLE');
  assert.match(factCell(html, 'admission'), /<b class="s-bad">AUTH REQUIRED<\/b>/);
  assert.match(html, /class="acr-status s-bad"/);
  assert.match(html, /UNAVAILABLE · AUTH REQUIRED/);
  assert.doesNotMatch(html, /data-acr-fact-tone="ok"/);
  assert.doesNotMatch(html, /class="acr-status s-ok"/);
});

test('a 403 is application access denied with provider state unknown', () => {
  assert.equal(privateReadAccessReasonForStatus(403), PRIVATE_READ_ACCESS_DENIED_REASON);
  assert.equal(privateReadAccessReasonForStatus(404), null);
  assert.equal(privateReadAccessReasonForStatus('403'), null);
  const access = privateReadErrorFact(PRIVATE_READ_ACCESS_DENIED_REASON);
  assert.equal(access.id, 'ACCESS_DENIED');
  assert.equal(access.label, 'ACCESS DENIED');
  assert.equal(access.tone, 'bad');
  assert.equal(access.guardTone, 'bad');
  assert.match(access.detail, /Application access is denied/);
  assert.match(access.detail, /provider state is UNKNOWN/);
  assert.doesNotMatch(access.detail, /provider (?:refused|denied|rejected|access)/i);

  const html = render(
    unavailablePrivateRead(PRIVATE_READ_ACCESS_DENIED_REASON),
    'STATE',
    PRIVATE_READ_ACCESS_DENIED_REASON,
  );
  assert.equal(attribute(html, 'data-acr-error'), PRIVATE_READ_ACCESS_DENIED_REASON);
  assert.equal(attribute(html, 'data-acr-tone'), 'bad');
  assert.equal(attribute(html, 'data-acr-state'), 'UNAVAILABLE');
  assert.match(factCell(html, 'admission'), /<b class="s-bad">ACCESS DENIED<\/b>/);
  assert.match(html, /class="acr-status s-bad"/);
  assert.match(html, /UNAVAILABLE · ACCESS DENIED/);
  assert.doesNotMatch(html, /data-acr-fact-tone="ok"/);
  assert.doesNotMatch(html, /class="acr-status s-ok"/);

  // An unrecognized failure is reported as a generic error: no provider text,
  // header, or credential material may reach the surface through this path.
  const opaque = privateReadErrorFact('401 Unauthorized: X-MBX-APIKEY rejected');
  assert.equal(opaque.code, 'PRIVATE_READ_ERROR');
  assert.equal(opaque.label, 'ERROR');
  assert.equal(opaque.tone, 'bad');
  const opaqueHtml = render(unavailablePrivateRead(), 'FALLBACK', '401 Unauthorized: X-MBX-APIKEY rejected');
  assert.doesNotMatch(opaqueHtml, /X-MBX-APIKEY|Unauthorized/);
  assert.equal(attribute(opaqueHtml, 'data-acr-error'), 'PRIVATE_READ_ERROR');
});

test('reverse completion keeps snapshot, source, and error behind one ordered gate', () => {
  const preferred = admitted(exactEmptyFixture(Date.now()));
  const fallback = unavailablePrivateRead('PRIVATE_READ_FALLBACK_UNAVAILABLE');
  const newerFallback = reducePrivateReadAppliedTruth(INITIAL_PRIVATE_READ_APPLIED_TRUTH, {
    requestId: 2,
    snapshot: fallback,
    source: 'FALLBACK',
    error: 'PRIVATE_READ_FALLBACK_UNAVAILABLE',
  });
  const staleState = reducePrivateReadAppliedTruth(newerFallback, {
    requestId: 1,
    snapshot: preferred,
    source: 'STATE',
    error: null,
  });
  assert.strictEqual(staleState, newerFallback);
  assert.strictEqual(staleState.snapshot, fallback);
  assert.equal(staleState.source, 'FALLBACK');
  assert.equal(staleState.error, 'PRIVATE_READ_FALLBACK_UNAVAILABLE');

  const recoveredState = reducePrivateReadAppliedTruth(newerFallback, {
    requestId: 3,
    snapshot: preferred,
    source: 'STATE',
    error: null,
  });
  assert.notStrictEqual(recoveredState, newerFallback);
  assert.strictEqual(recoveredState.snapshot, preferred);
  assert.equal(recoveredState.source, 'STATE');
  assert.equal(recoveredState.error, null);

  const staleAccessFailure = reducePrivateReadAppliedTruth(recoveredState, {
    requestId: 2,
    snapshot: unavailablePrivateRead(PRIVATE_READ_ACCESS_DENIED_REASON),
    source: 'FALLBACK',
    error: PRIVATE_READ_ACCESS_DENIED_REASON,
  });
  assert.strictEqual(staleAccessFailure, recoveredState);
  assert.strictEqual(staleAccessFailure.snapshot, preferred);
  assert.equal(staleAccessFailure.source, 'STATE');
  assert.equal(staleAccessFailure.error, null);
});

test('the store classifies application access failures without adding a transport', async () => {
  const store = await read('store.tsx');
  assert.match(store, /function privateReadAccessReason\(cause: unknown\): string \| null \{/);
  assert.match(store, /cause instanceof ApiRequestError\s*\?\s*privateReadAccessReasonForStatus\(cause\.status\)/);
  assert.equal((store.match(/privateReadAccessReason\(cause\)/g) ?? []).length, 3);
  assert.match(store, /setPrivateReadApplied\(\(current\) => reducePrivateReadAppliedTruth\(current, update\)\)/);
  assert.match(store, /source: 'STATE'/);
  assert.match(store, /source: 'FALLBACK'/);
  assert.doesNotMatch(store, /PRIVATE_READ_(?:REQUEST_)?DENIED|provider refused/i);
});

test('an unreported error is neutral truth, never a green admission and never a downgrade', () => {
  const absent = privateReadErrorFact(null);
  assert.equal(absent.id, 'NONE');
  assert.equal(absent.label, 'NO ERROR REPORTED');
  assert.notEqual(absent.label, 'NONE');
  assert.equal(absent.tone, 'idle', 'silence is not a proven admission');
  assert.equal(absent.guardTone, 'ok', 'silence imposes no downgrade of its own');

  // A proven read keeps its green overall guard, while the admission cell that
  // only reports the absence of an error stays neutral.
  const proven = render(admitted(exactEmptyFixture(Date.now())));
  assert.equal(attribute(proven, 'data-acr-tone'), 'ok');
  assert.equal(attribute(proven, 'data-acr-error'), 'NO_ERROR_REPORTED');
  const cell = factCell(proven, 'admission');
  assert.match(cell, /data-acr-fact-tone="idle"/);
  assert.match(cell, /<b class="s-idle">NO ERROR REPORTED<\/b>/);
  assert.doesNotMatch(cell, /s-ok|>NONE</);

  // An unproven read gains nothing from that silence.
  for (const [snapshot, expected] of [
    [admitted(notConfiguredFixture()), 'idle'],
    [unavailablePrivateRead(), 'bad'],
  ]) {
    const html = render(snapshot, 'PENDING');
    assert.equal(attribute(html, 'data-acr-tone'), expected);
    assert.match(factCell(html, 'admission'), /<b class="s-idle">NO ERROR REPORTED<\/b>/);
  }
});

test('stale, unsafe, not configured, unknown, and source states stay explicit', () => {
  const stale = render(admitted(exactEmptyFixture(Date.now() - PRIVATE_READ_STALE_AFTER_MS - 60_000)));
  assert.equal(attribute(stale, 'data-acr-freshness'), 'STALE');
  assert.equal(attribute(stale, 'data-acr-tone'), 'warn');
  assert.match(factCell(stale, 'freshness'), /<b class="s-warn">STALE<\/b>/);

  const current = render(admitted(exactEmptyFixture(Date.now())));
  assert.equal(attribute(current, 'data-acr-freshness'), 'CURRENT');
  assert.equal(attribute(current, 'data-acr-tone'), 'ok');
  assert.match(factCell(current, 'permission'), /VERIFIED_READ_ONLY/);
  assert.match(factCell(current, 'private-read'), /AVAILABLE/);

  const unsafe = render(admitted(unsafePostureFixture(Date.now())), 'STATE');
  assert.equal(attribute(unsafe, 'data-acr-posture'), 'UNSAFE');
  assert.equal(attribute(unsafe, 'data-acr-tone'), 'bad');
  assert.match(factCell(unsafe, 'permission'), /<b class="s-bad">UNSAFE<\/b>/);

  const notConfigured = render(admitted(notConfiguredFixture()), 'PENDING');
  assert.equal(attribute(notConfigured, 'data-acr-state'), 'NOT_CONFIGURED');
  assert.equal(attribute(notConfigured, 'data-acr-posture'), 'NOT_CONFIGURED');
  assert.equal(attribute(notConfigured, 'data-acr-tone'), 'idle');
  assert.match(factCell(notConfigured, 'open-orders'), /NOT_CONFIGURED/);

  const unavailable = render(unavailablePrivateRead(), 'FALLBACK');
  assert.equal(attribute(unavailable, 'data-acr-state'), 'UNAVAILABLE');
  assert.equal(attribute(unavailable, 'data-acr-freshness'), 'UNKNOWN');
  assert.match(factCell(unavailable, 'coverage'), /Coverage Unavailable/);
  assert.match(factCell(unavailable, 'reconciliation'), /Reconciliation Unavailable/);

  // Every transport the store can publish is named on the surface.
  for (const [source, snapshot] of [
    ['PENDING', admitted(notConfiguredFixture())],
    ['STATE', admitted(exactEmptyFixture(Date.now()))],
    ['FALLBACK', unavailablePrivateRead()],
  ]) {
    const html = render(snapshot, source);
    assert.equal(attribute(html, 'data-acr-source'), source);
    assert.match(factCell(html, 'source'), new RegExp(`>${source}</b>`));
  }
});

test('the globally visible header account status reads the same store truth', async () => {
  const header = await read('components/Header.tsx');
  assert.match(header, /<AccountSheet \/>/);
  assert.match(header, /const accountErrorFact = privateReadErrorFact\(privateReadError\);/);
  assert.match(header, /privateReadPresentation\.guardTone/);

  // The sheet consumes the shared store the shell already provides: same
  // projection, same admitted error fact, and no transport of its own.
  const sheetStart = header.indexOf('function AccountSheet()');
  assert.ok(sheetStart > 0);
  const sheet = header.slice(sheetStart, header.indexOf('\n}\n', sheetStart));
  assert.match(sheet, /const \{ privateRead, privateReadError \} = useStore\(\);/);
  assert.match(sheet, /const presentation = projectPrivateRead\(privateRead\);/);
  assert.match(sheet, /const errorFact = privateReadErrorFact\(privateReadError\);/);
  assert.match(sheet, /value=\{presentation\.state\}/);
  assert.match(sheet, /value=\{privateRead\.permissionPosture\.state\}/);
  assert.match(sheet, /value=\{errorFact\.label\} tone=\{errorFact\.tone\}/);
  assert.doesNotMatch(sheet, /fetch|useEffect|useState|setInterval|setTimeout|'\/api\//);
  assert.doesNotMatch(sheet, /<button|onClick/);
  // The retired static claims cannot return.
  assert.doesNotMatch(header, /NOT MOUNTED/);
  assert.doesNotMatch(header, /const accountTone = 'off'/);
  assert.doesNotMatch(header, /const accountSub = 'OWNER GATED · NOT CONFIGURED'/);
  assert.doesNotMatch(header, /Private account truth is outside this candidate/);
});

test('static CSS declarations preserve the restrained container-query contract', async () => {
  const [css, shell] = await Promise.all([
    read('components/AccountCockpitRail.css'),
    read('styles.css'),
  ]);

  assert.match(css, /\.acr-rail \{[\s\S]*?container-type: inline-size;[\s\S]*?\}/);
  assert.match(css, /\.acr-rail \{[\s\S]*?border: 1px solid var\(--line-2\);[\s\S]*?\}/);
  assert.match(css, /\.acr-rail \{[\s\S]*?border-radius: 12px;[\s\S]*?\}/);
  assert.match(css, /\.acr-rail \{[\s\S]*?background: var\(--panel\);[\s\S]*?\}/);
  assert.match(css, /\.acr-rail \{[\s\S]*?box-shadow: var\(--shadow-sm\);[\s\S]*?\}/);
  assert.match(css, /\[data-theme="dark"\] \.acr-rail \{[\s\S]*?box-shadow: none;/);
  assert.match(css, /font-size: 10\.5px;[\s\S]*?letter-spacing: \.055em;/);

  // The hairline lattice is painted by the 1px gap, so every declared column
  // count must divide the twelve facts or the track shows as a solid block.
  const columnCounts = [...css.matchAll(/grid-template-columns: repeat\((\d+), minmax\(0, 1fr\)\)/g)]
    .map(([, count]) => Number(count));
  assert.ok(columnCounts.length >= 3);
  for (const count of columnCounts) assert.equal(12 % count, 0, `12 facts must fill ${count} columns`);
  assert.match(css, /overflow-wrap: anywhere;/);
  assert.match(css, /min-width: 0;/);

  // The declaration contract leaves rail widths above the largest breakpoint
  // on the default six-column, two-row tape. Actual reflow and overflow are
  // verified separately in a rendered browser.
  const breakpoints = [...css.matchAll(/@container account-cockpit-rail \(max-width: (\d+)px\)/g)]
    .map(([, width]) => Number(width));
  assert.equal(breakpoints.length, 4);
  assert.deepEqual([...breakpoints].sort((a, b) => b - a), breakpoints, 'breakpoints must descend');
  assert.ok(Math.max(...breakpoints) <= 960, 'a ~1090px rail must keep the default six columns');

  // Below three columns the tape must already be the bounded two-row canvas
  // that scrolls inside the rail: six or twelve stacked rows would bury the
  // route on a short screen.
  const scrollerStart = css.indexOf('@container account-cockpit-rail (max-width: 620px)');
  const compactStart = css.indexOf('@container account-cockpit-rail (max-width: 430px)');
  assert.ok(scrollerStart > 0 && compactStart > scrollerStart);
  const scroller = css.slice(scrollerStart, compactStart);
  assert.match(scroller, /grid-auto-flow: column;/);
  assert.match(scroller, /grid-template-rows: repeat\(2, minmax\(0, auto\)\);/);
  assert.match(scroller, /grid-auto-columns: minmax\(\d{3}px, 1fr\);/);
  assert.doesNotMatch(scroller, /grid-template-columns: (?:minmax|repeat)/);
  // The narrowest step only tightens that same tape.
  const compact = css.slice(compactStart);
  assert.doesNotMatch(compact, /grid-template|grid-auto/);
  assert.match(compact, /text-overflow: ellipsis;/);
  assert.match(css, /\.acr-facts \{[\s\S]*?overflow: auto hidden;[\s\S]*?\}/);
  assert.match(css, /\.acr-facts \{[\s\S]*?overscroll-behavior-x: contain;[\s\S]*?\}/);
  // The scroll canvas reuses the shared focus colour, drawn inside the clipped
  // rail edge so the indicator stays visible.
  assert.match(css, /\.acr-facts:focus-visible \{\s*outline-offset: -2px;\s*\}/);
  assert.doesNotMatch(css, /outline:\s*none/);

  // Not a fixed rail, not sticky, and no motion of its own. The checks are
  // declaration-aware so the house `text-transform` typography still passes.
  assert.doesNotMatch(css, /position:\s*(?:fixed|sticky)/);
  assert.doesNotMatch(css, /@keyframes/);
  assert.doesNotMatch(css, /[\s;{](?:animation|transition)[a-z-]*\s*:/);
  assert.doesNotMatch(css, /[\s;{]transform[a-z-]*\s*:/);
  assert.match(css, /text-transform: uppercase;/);

  // The route wrapper stays layout-only, and the shell keeps its 5px + 6px edge.
  assert.match(shell, /\.app-page-frame \{\s*overflow: visible !important;\s*border: 0 !important;/);
  assert.match(shell, /\.app-main main\.app-page-main \{\s*padding-top: 5px !important;\s*\}/);
  assert.match(shell, /\.app-main main\.app-page-main > \.app-page-frame > \.container\.page \{\s*padding-top: 6px !important;\s*\}/);
});
