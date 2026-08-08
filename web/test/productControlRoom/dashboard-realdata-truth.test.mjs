import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [dashboardSource, systemDashboardSource] = await Promise.all([
  readFile(new URL('../../src/pages/Dashboard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../../src/features/systemDashboard/SystemDashboard.tsx', import.meta.url), 'utf8'),
]);

test('Delegated Dashboard retires page-local private-account projection', () => {
  assert.match(dashboardSource, /binding\.snapshot\?\.dashboard \?\? null/);
  assert.match(dashboardSource, /<SystemDashboard[\s\S]*snapshot=\{dashboardSnapshot\}/);
  assert.match(systemDashboardSource, /<CapitalPanel snapshot=\{snapshot\} \/>/);
  assert.doesNotMatch(
    dashboardSource,
    /projectPrivateRead|privateRead|exactOrDash|state\.account|privateAccountTruth/,
  );
});

test('Delegated Dashboard hard-gates the complete canonical snapshot on proven continuity', () => {
  assert.match(dashboardSource, /const continuityProven = binding\.continuity === 'PROVEN'/);
  assert.match(
    dashboardSource,
    /const dashboardSnapshot = continuityProven[\s\S]*\? binding\.snapshot\?\.dashboard \?\? null[\s\S]*: null/,
  );
  assert.match(systemDashboardSource, /if \(!snapshot\)[\s\S]*Canonical Supervisor Unreachable/);
  assert.match(systemDashboardSource, /props\.readOnlyProjection !== true && \([\s\S]*<ControlsPanel/);
});

test('Delegated Dashboard carries no page-local market recomputation', () => {
  assert.match(systemDashboardSource, /<SourceHealthPanel snapshot=\{snapshot\} nowMs=\{nowMs\} \/>/);
  assert.doesNotMatch(
    dashboardSource,
    /resolveMarketFreshness|selectDashboardMarketValues|formatCompactUsdtPrice|marketFeedReadiness|\/api\/markets/,
  );
  assert.doesNotMatch(dashboardSource, /['"]\/api\/engine\/(?:basis|volume)/);
});

test('Delegated Dashboard retires page-local PnL fetch and strategy attribution', () => {
  assert.doesNotMatch(
    dashboardSource,
    /\/api\/pnl|fetchJson|decodeDashboardPnlData|useDashboardSources|Validated Account PnL Context|Strategy Performance/,
  );
  assert.match(dashboardSource, /Review provider fill evidence/);
  assert.match(dashboardSource, /read-only Account fills from symbol-scoped private-provider history/);
  assert.match(dashboardSource, /does not place, cancel, or alter orders/);
});

test('Delegated Dashboard exposes no retired page-local decoder exports', () => {
  assert.doesNotMatch(
    dashboardSource,
    /export function (?:decodeDashboardPnlData|selectDashboardMarketValues)/,
  );
  assert.equal(
    (dashboardSource.match(/export function /g) ?? []).length,
    1,
    'Dashboard exports only its page component',
  );
});

test('Delegated Dashboard preserves truthful unavailable and no-effect boundaries', () => {
  assert.match(dashboardSource, /readOnlyProjection/);
  assert.match(dashboardSource, /Material-event continuity is \$\{binding\.continuity\}/);
  assert.match(systemDashboardSource, /Canonical Supervisor Unreachable/);
  assert.doesNotMatch(dashboardSource, /method:\s*['"]POST['"]/);
  assert.doesNotMatch(dashboardSource, /new WebSocket|\.send\(/);
  assert.doesNotMatch(dashboardSource, /mutate=|lastReceipt=/);
});
