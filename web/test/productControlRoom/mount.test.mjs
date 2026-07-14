import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SURFACE_MOUNT_CONTRACTS } from '../../src/features/productControlRoom/surfaceMounts.ts';

const read = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8');

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
  assert.doesNotMatch(app, /FixtureProductControlRoom|fixtureBinding|preview\/main/);
});

test('all eighteen mount contracts are registered once without legacy convergence summaries', async () => {
  assert.equal(SURFACE_MOUNT_CONTRACTS.length, 18);
  assert.equal(new Set(SURFACE_MOUNT_CONTRACTS.map((entry) => entry.surfaceId)).size, 18);

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
  assert.match(header, /intakeTone/);
  assert.doesNotMatch(header, /useSystemIntegration|mutateSystemControl|SystemControlMutation/);
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
  assert.match(dashboard, /props\.readOnlyProjection !== true && \(/);
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
