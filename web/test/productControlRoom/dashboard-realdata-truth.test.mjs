import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [dashboardSource, systemDashboardSource] = await Promise.all([
  readFile(new URL('../../src/pages/Dashboard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../../src/features/systemDashboard/SystemDashboard.tsx', import.meta.url), 'utf8'),
]);

test('Owner Dashboard consumes exactly one private-account projection', () => {
  assert.match(dashboardSource, /const privatePresentation = projectPrivateRead\(privateRead, nowMs\)/);
  assert.equal(
    (dashboardSource.match(/projectPrivateRead\(/g) ?? []).length,
    1,
    'Dashboard consumes one private-read projection and recomputes none of it',
  );
  assert.match(dashboardSource, /const privateValuesCurrent = privatePresentation\.freshness\.state === 'CURRENT'/);
  assert.match(systemDashboardSource, /<CapitalPanel snapshot=\{snapshot\} \/>/);
});

test('Owner Dashboard hard-gates canonical snapshot values on proven continuity', () => {
  assert.match(
    dashboardSource,
    /const productCurrent = retainedProductSnapshot !== null && productBinding\.continuity === 'PROVEN'/,
  );
  assert.match(dashboardSource, /const productSnapshot = productCurrent \? retainedProductSnapshot : null/);
  assert.match(systemDashboardSource, /if \(!snapshot\)[\s\S]*Canonical Supervisor Unreachable/);
  assert.match(systemDashboardSource, /props\.readOnlyProjection !== true && \([\s\S]*<ControlsPanel/);
});

test('Owner Dashboard reads market truth from the store without a page-local market fetch', () => {
  assert.match(systemDashboardSource, /<SourceHealthPanel snapshot=\{snapshot\} nowMs=\{nowMs\} \/>/);
  assert.match(dashboardSource, /const marketValuesCurrent = Boolean\(/);
  assert.doesNotMatch(dashboardSource, /['"]\/api\/markets/);
  assert.doesNotMatch(dashboardSource, /['"]\/api\/engine\/(?:basis|volume)/);
});

test('Owner Dashboard admits its account PnL read only behind the private-read guard', () => {
  assert.match(dashboardSource, /fetchJson<unknown>\('\/api\/pnl'/);
  assert.match(dashboardSource, /const admittedPnl = pnlReadEnabled \? sources\.pnl\.data : null/);
  assert.equal(
    (dashboardSource.match(/\/api\//g) ?? []).length,
    1,
    'Dashboard reads exactly one page-local endpoint',
  );
  assert.match(dashboardSource, /not attributed to Basis or Volume/);
  assert.doesNotMatch(dashboardSource, /Strategy Performance/);
});

test('Owner Dashboard exports its page component and its two source decoders', () => {
  assert.match(dashboardSource, /export function decodeDashboardPnlData/);
  assert.match(dashboardSource, /export function selectDashboardMarketValues/);
  assert.equal(
    (dashboardSource.match(/export function /g) ?? []).length,
    3,
    'Dashboard exports its page component and its two source decoders',
  );
});

test('Owner Dashboard preserves truthful unavailable and no-effect boundaries', () => {
  assert.match(dashboardSource, /Product continuity \$\{productBinding\.continuity\}/);
  assert.match(dashboardSource, /Canonical Runtime Unavailable/);
  assert.match(systemDashboardSource, /Canonical Supervisor Unreachable/);
  assert.doesNotMatch(dashboardSource, /method:\s*['"]POST['"]/);
  assert.doesNotMatch(dashboardSource, /new WebSocket|\.send\(/);
  assert.doesNotMatch(dashboardSource, /mutate=|lastReceipt=/);
});
