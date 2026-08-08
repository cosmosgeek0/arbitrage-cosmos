import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [dashboardSource, systemDashboardSource] = await Promise.all([
  readFile(new URL('../../src/pages/Dashboard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../../src/features/systemDashboard/SystemDashboard.tsx', import.meta.url), 'utf8'),
]);

test('Epoch 5R Dashboard admits only proven canonical supervisor truth', () => {
  assert.match(
    dashboardSource,
    /const continuityProven = binding\.continuity === 'PROVEN'/,
  );
  assert.match(
    dashboardSource,
    /const dashboardSnapshot = continuityProven[\s\S]*\? binding\.snapshot\?\.dashboard \?\? null[\s\S]*: null/,
  );
  assert.match(
    dashboardSource,
    /<SystemDashboard[\s\S]*snapshot=\{dashboardSnapshot\}[\s\S]*readOnlyProjection/,
  );
  assert.match(dashboardSource, /ProductSurfaceAdapter/);
  assert.equal(
    (dashboardSource.match(/<ProductSurfaceAdapter surfaceId="dashboard" \/>/g) ?? []).length,
    1,
    'Dashboard must retain its one registered canonical surface band',
  );
  assert.doesNotMatch(dashboardSource, /\/api\/pnl|fetchJson|useDashboardSources|decodeDashboardPnlData/);
  assert.doesNotMatch(
    dashboardSource,
    /projectPrivateRead|resolveMarketFreshness|privateRead|marketsUpdatedAt|privateAccountTruth/,
  );
  assert.doesNotMatch(dashboardSource, /mutate=|lastReceipt=/);
});

test('Epoch 5R Dashboard exposes exactly one truthful page task routed to fills', () => {
  assert.equal(
    (dashboardSource.match(/data-dashboard-task/g) ?? []).length,
    1,
    'Dashboard must declare one page task',
  );
  assert.equal(
    (dashboardSource.match(/<button\b/g) ?? []).length,
    1,
    'Dashboard must expose one page-local task control',
  );
  assert.equal(
    (dashboardSource.match(/setPage\(/g) ?? []).length,
    1,
    'Dashboard task must have one navigation effect',
  );
  assert.match(dashboardSource, /onClick=\{\(\) => setPage\('fills'\)\}/);
  assert.match(dashboardSource, />\s*Review Account Fills\s*</);
  assert.match(dashboardSource, /Review provider fill evidence/);
  assert.match(dashboardSource, /read-only Account fills from symbol-scoped private-provider history/);
  assert.match(dashboardSource, /does not place, cancel, or alter orders/);
  assert.doesNotMatch(dashboardSource, /fills ledger/);
  assert.doesNotMatch(dashboardSource, /setPage\('account'\)/);
});

test('Epoch 5R consolidation retains the complete canonical dashboard presentation', () => {
  for (const panel of [
    'PostureStrip',
    'ExposureBanner',
    'AttentionQueuePanel',
    'MachineGraph',
    'SourceHealthPanel',
    'EnginesPanel',
    'BrainPanel',
    'CapitalPanel',
    'RiskExecutionPanel',
    'TraceDrilldown',
  ]) {
    assert.match(systemDashboardSource, new RegExp(`<${panel}\\b`), `${panel} must remain mounted`);
  }
  assert.match(
    systemDashboardSource,
    /props\.readOnlyProjection !== true && \([\s\S]*<ControlsPanel/,
    'backend controls remain available only to an interactive canonical caller',
  );
  assert.match(systemDashboardSource, /Canonical Supervisor Unreachable/);
});
