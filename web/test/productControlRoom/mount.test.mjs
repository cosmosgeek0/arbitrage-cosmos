import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { SURFACE_MOUNT_CONTRACTS } from '../../src/features/productControlRoom/surfaceMounts.ts';

const read = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8');
const sourceExists = async (path) => {
  try {
    await access(new URL(`../../src/${path}`, import.meta.url));
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
};

test('production shell owns one frozen product client, provider, durable cursor, and full route', async () => {
  const app = await read('App.tsx');
  const endpoints = [
    '/api/product-integration/v1/supervisor',
    '/api/product-integration/v1/material-events',
    '/api/product-integration/v1/traces/',
    '/api/product-integration/v1/commands/preview',
    '/api/product-integration/v1/commands',
  ];
  for (const endpoint of endpoints) assert.match(app, new RegExp(endpoint.replaceAll('/', '\\/')));
  assert.equal((app.match(/createProductIntegrationClient\s*\(/g) ?? []).length, 1);
  assert.equal((app.match(/<ProductControlRoomProvider\b/g) ?? []).length, 1);
  assert.match(app, /readDurableMaterialCursor\(\)/);
  assert.doesNotMatch(app, /DURABLE_RESUME_CURSOR|initialMaterialCursor=\{"0"\}/);
  assert.match(app, /page === 'control-room' && <ProductControlRoomRoute \/>/);
  assert.match(app, /useProductControlRoomContext\(\)/);
  for (const attribute of [
    'data-i00-product-binding-state',
    'data-i00-product-revision',
    'data-i00-product-digest',
    'data-i00-product-evaluated-at-ms',
    'data-i00-product-truth-label',
    'data-i00-product-persistent-synthetic',
    'data-i00-product-continuity',
    'data-i00-product-machine-ready',
    'data-i00-product-trade-ready',
    'data-i00-product-effective-mode',
    'data-i00-product-tested-commit',
    'data-i00-product-schema-revision',
  ]) assert.match(app, new RegExp(attribute));
  assert.doesNotMatch(app, /FixtureProductControlRoom|fixtureBinding|preview\/main/);
});

test('all eighteen mount contracts are registered once and the retired convergence renderer is absent', async () => {
  assert.equal(SURFACE_MOUNT_CONTRACTS.length, 18);
  assert.equal(new Set(SURFACE_MOUNT_CONTRACTS.map((entry) => entry.surfaceId)).size, 18);
  for (const contract of SURFACE_MOUNT_CONTRACTS) {
    assert.doesNotMatch(contract.insertionAnchor, /\bMISSING\b|must add|must pass/i);
    assert.doesNotMatch(contract.insertionAnchor, /SystemIntegrationSurface|legacy convergence/i);
    if (contract.mountKind === 'REPLACE_LEGACY_SUMMARY') {
      assert.equal(contract.insertionAnchor, `<ProductSurfaceAdapter surfaceId="${contract.surfaceId}" />`);
    }
  }

  for (const retiredSource of [
    'components/SystemIntegrationSurface.tsx',
    'components/SystemIntegrationSurface.css',
  ]) {
    assert.equal(await sourceExists(retiredSource), false, `${retiredSource} must stay deleted`);
  }

  const mounts = new Map([
    ['pages/Dashboard.tsx', 'dashboard'],
    ['pages/Markets.tsx', 'markets'],
    ['pages/TokenDetail.tsx', 'token'],
    ['pages/Strategies.tsx', 'basis'],
    ['pages/VolumeScanner.tsx', 'volume'],
    ['pages/Opportunities.tsx', 'opportunities'],
    ['pages/Loans.tsx', 'borrow'],
    ['pages/Risk.tsx', 'risk'],
    ['pages/SystemHealth.tsx', 'health'],
    ['pages/LedgerPage.tsx', 'logs-ledger'],
    ['pages/NotificationsPage.tsx', 'notifications'],
  ]);
  for (const [path, surfaceId] of mounts) {
    const source = await read(path);
    assert.match(source, new RegExp(`<ProductSurfaceAdapter surfaceId=["']${surfaceId}["'] \\/>`));
    assert.equal((source.match(new RegExp(`surfaceId=["']${surfaceId}["']`, 'g')) ?? []).length, 1);
  }

  const account = await read('pages/Account.tsx');
  for (const surfaceId of ['account', 'execution', 'orders', 'positions', 'fills', 'pnl']) {
    assert.match(account, new RegExp(`<ProductSurfaceAdapter surfaceId=["']${surfaceId}["'] \\/>`));
    assert.equal((account.match(new RegExp(`surfaceId=["']${surfaceId}["']`, 'g')) ?? []).length, 1);
  }

  for (const path of ['pages/Dashboard.tsx', 'pages/Opportunities.tsx', 'pages/Risk.tsx', 'pages/SystemHealth.tsx', 'pages/LedgerPage.tsx']) {
    assert.doesNotMatch(await read(path), /SystemIntegrationSurface/);
  }
});

test('bottom-up pages keep native summaries ahead of canonical surface bands', async () => {
  const surfaces = [
    ['pages/SystemHealth.tsx', 'healthx-summary', 'health', 'healthx-alert'],
    ['pages/Risk.tsx', 'riskx-summary', 'risk', 'riskx-section'],
    ['pages/Opportunities.tsx', 'opportunityx-summary', 'opportunities', 'opportunityx-filters'],
    ['pages/VolumeScanner.tsx', 'volx-summary', 'volume', 'volx-filters'],
    ['pages/Strategies.tsx', 'volx-summary', 'basis', 'volx-filters'],
    ['pages/Dashboard.tsx', 'dcx-summary', 'dashboard', 'dcx-section'],
  ];

  for (const [path, summaryClass, surfaceId, nextClass] of surfaces) {
    const source = await read(path);
    const summaryIndex = source.indexOf(`className="${summaryClass}"`);
    const adapterIndex = source.indexOf(`<ProductSurfaceAdapter surfaceId="${surfaceId}" />`);
    const nextIndex = source.indexOf(`className="${nextClass}`, adapterIndex);
    assert.ok(summaryIndex >= 0, `${path} must retain its native summary`);
    assert.ok(adapterIndex > summaryIndex, `${path} must append ${surfaceId} after its native summary`);
    assert.ok(nextIndex > adapterIndex, `${path} must mount ${surfaceId} before the next native section`);
  }
});

test('account and dashboard summary typography and hairlines retain the measured ship-gate contract', async () => {
  const [accountCss, dashboardCss] = await Promise.all([
    read('pages/Account.css'),
    read('pages/Dashboard.css'),
  ]);
  const rule = (source, selector) => {
    const marker = `${selector} {`;
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `missing CSS rule ${selector}`);
    const end = source.indexOf('}', start + marker.length);
    assert.ok(end > start, `unterminated CSS rule ${selector}`);
    return source.slice(start + marker.length, end);
  };

  const accountBand = rule(accountCss, '.accountx-summary');
  assert.match(accountBand, /gap:\s*0;/);
  assert.match(accountBand, /min-height:\s*102px;/);
  assert.match(accountBand, /padding:\s*0;/);
  assert.match(accountBand, /background:\s*var\(--panel\);/);

  const accountTile = rule(accountCss, '.accountx-summary article');
  assert.match(accountTile, /min-height:\s*0;/);
  assert.match(accountTile, /padding:\s*17px 18px;/);
  assert.match(accountTile, /border-right:\s*1px solid var\(--line-2\);/);
  assert.doesNotMatch(accountTile, /(?:^|\s)border\s*:|border-radius\s*:|background\s*:/);

  const accountLabel = rule(accountCss, '.accountx-summary article > span');
  assert.match(accountLabel, /font-size:\s*10\.5px;/);
  assert.match(accountLabel, /font-weight:\s*560;/);
  assert.match(accountLabel, /line-height:\s*14px;/);
  assert.match(accountLabel, /letter-spacing:\s*\.055em;/);
  assert.match(accountLabel, /text-transform:\s*uppercase;/);
  assert.match(rule(accountCss, '.accountx-summary article > strong'), /font-size:\s*18px;[\s\S]*font-weight:\s*510;/);
  assert.match(accountCss, /\.accountx-summary article:nth-child\(n \+ 3\)\s*\{\s*border-top:\s*1px solid var\(--line-2\);\s*\}/);
  assert.match(accountCss, /\.accountx-summary article:nth-child\(n \+ 2\)\s*\{\s*border-top:\s*1px solid var\(--line-2\);\s*\}/);

  assert.match(rule(dashboardCss, '.dcx-summary > .dcx-summary-cell > span'), /letter-spacing:\s*\.055em;/);
  assert.match(rule(dashboardCss, '.dcx-summary > .dcx-summary-cell > strong'), /font-weight:\s*510;/);
  assert.match(rule(dashboardCss, '.dcx-summary,\n.dcx-performance-summary'), /min-height:\s*102px;/);
});

test('account routes are controlled and header consumes read-only product truth', async () => {
  const [app, account, store, header] = await Promise.all([
    read('App.tsx'),
    read('pages/Account.tsx'),
    read('store.tsx'),
    read('components/Header.tsx'),
  ]);
  for (const view of ['overview', 'execution', 'orders', 'positions', 'fills', 'pnl']) {
    assert.match(account, new RegExp(`'${view}'`));
  }
  for (const view of ['execution', 'orders', 'positions', 'fills', 'pnl']) {
    assert.match(app, new RegExp(`page === '${view}' && <Account view=["']${view}["'] \\/>`));
  }
  assert.match(store, /\| 'control-room'/);
  assert.match(store, /\| 'execution'/);
  assert.match(header, /useProductControlRoomContext/);
  assert.match(header, /setPage\('control-room'\)/);
  assert.match(header, /const killSwitchClearProven = Boolean\(/);
  assert.match(header, /productSnapshot/);
  assert.match(header, /productBinding\.continuity === 'PROVEN'/);
  assert.match(header, /killSwitchControl\?\.wiringState === 'WIRED_LIVE'/);
  assert.match(header, /killSwitchState\.trim\(\)\.toUpperCase\(\) === 'CLEAR'/);
  assert.match(header, /const convergenceKillOn = !killSwitchClearProven/);
  assert.match(header, /const convergenceTone = 'warn'/);
  assert.doesNotMatch(header, /productMachineReadinessTone/);
  assert.doesNotMatch(header, /dashboard\.overallPosture/);
  assert.match(header, /intakeTone/);
  assert.doesNotMatch(header, /useSystemIntegration|mutateSystemControl|SystemControlMutation/);
});

test('mobile shell preserves the canonical non-green execution identity', async () => {
  const css = await read('styles.css');
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.hdr-right > \.smenu-bar\.topbar-suite-v4\s*\{[\s\S]*display:\s*inline-flex !important;/);
  assert.match(css, /\.hdr-right > \.smenu-bar\.topbar-suite-v4 > button\[data-topbar-key="power"\]\s*\{[\s\S]*display:\s*inline-flex !important;/);
});

test('dashboard and health read the shared Product snapshot without a legacy health poll', async () => {
  for (const path of ['pages/Dashboard.tsx', 'pages/SystemHealth.tsx']) {
    const source = await read(path);
    assert.match(source, /useProductControlRoomContext/);
    assert.doesNotMatch(source, /\/api\/system(?!-integration)/);
  }
  const health = await read('pages/SystemHealth.tsx');
  assert.match(health, /binding\.refresh\(\)/);
  assert.match(health, /ownerView\.machineReady/);
});

test('product mount uses live trace reads and structurally omits donor action surfaces', async () => {
  const [route, controlRoom, dashboard, css] = await Promise.all([
    read('features/productControlRoom/ProductControlRoomRoute.tsx'),
    read('features/productControlRoom/ProductControlRoom.tsx'),
    read('features/systemDashboard/SystemDashboard.tsx'),
    read('features/productControlRoom/styles/productControlRoom.css'),
  ]);
  assert.match(route, /client\.readTrace\(correlationId, 200\)/);
  assert.match(controlRoom, /readOnlyProjection/);
  assert.match(controlRoom, /traceRequestRef\.current === requestId/);
  assert.doesNotMatch(controlRoom, /mutate=\{\(\) => undefined\}/);
  const attentionQueueIndex = dashboard.indexOf('<AttentionQueuePanel');
  const readOnlyGateIndex = dashboard.indexOf('props.readOnlyProjection !== true && (');
  const controlsPanelIndex = dashboard.indexOf('<ControlsPanel');
  assert.ok(attentionQueueIndex >= 0);
  assert.ok(readOnlyGateIndex >= 0);
  assert.ok(controlsPanelIndex >= 0);
  assert.ok(attentionQueueIndex < readOnlyGateIndex);
  assert.ok(readOnlyGateIndex < controlsPanelIndex);
  assert.match(dashboard, /<AttentionQueuePanel[\s\S]*onControl=\{props\.mutate\}[\s\S]*\/>/);
  assert.equal((dashboard.match(/props\.readOnlyProjection !== true && \(/g) ?? []).length, 1);
  assert.match(dashboard, /\{props\.readOnlyProjection !== true && \([\s\S]*<ControlsPanel/);
  assert.doesNotMatch(css, /aria-label="Controls"/);
  assert.doesNotMatch(css, /aria-label="Attention queue"/);
});

test('control and incident truth labels cannot render false green or false all-clear', async () => {
  const [controls, incidents, css] = await Promise.all([
    read('features/productControlRoom/components/ControlRegistryPanel.tsx'),
    read('features/productControlRoom/components/IncidentCursorPanel.tsx'),
    read('features/productControlRoom/styles/productControlRoom.css'),
  ]);
  assert.match(controls, /global\.kill-switch\.engage/);
  assert.doesNotMatch(controls, /'global\.kill-switch'/);
  assert.match(controls, /NO_RESULT_TRUTH/);
  assert.match(controls, /CANONICAL/);
  assert.doesNotMatch(controls, />NON_SYNTHETIC</);
  assert.match(incidents, /availability\.state !== 'AVAILABLE'/);
  assert.match(incidents, /Incident owner is available; no grouped incident requires attention/);
  assert.doesNotMatch(css, /truth-live-public\s*,\s*\.pcr-surface-end em\.truth-wired/);
});
