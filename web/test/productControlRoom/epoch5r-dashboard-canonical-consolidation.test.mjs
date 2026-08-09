import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [dashboardSource, systemDashboardSource] = await Promise.all([
  readFile(new URL('../../src/pages/Dashboard.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../../src/features/systemDashboard/SystemDashboard.tsx', import.meta.url), 'utf8'),
]);

test('Owner Dashboard admits only proven canonical supervisor truth', () => {
  assert.match(
    dashboardSource,
    /const productCurrent = retainedProductSnapshot !== null && productBinding\.continuity === 'PROVEN'/,
  );
  assert.match(
    dashboardSource,
    /const productSnapshot = productCurrent \? retainedProductSnapshot : null/,
  );
  // Engine values re-enter the page only when the canonical component is both
  // operational and fresh; absence must not render as a measured zero.
  assert.match(
    dashboardSource,
    /const basisStrategy = engineValuesCurrent\(basisComponent, rawBasisStrategy\) \? rawBasisStrategy : null/,
  );
  assert.match(
    dashboardSource,
    /const volumeStrategy = engineValuesCurrent\(volumeComponent, rawVolumeStrategy\) \? rawVolumeStrategy : null/,
  );
  assert.match(dashboardSource, /ProductSurfaceAdapter/);
  assert.equal(
    (dashboardSource.match(/<ProductSurfaceAdapter surfaceId="dashboard" \/>/g) ?? []).length,
    1,
    'Dashboard must retain its one registered canonical surface band',
  );
  assert.doesNotMatch(dashboardSource, /mutate=|lastReceipt=/);
});

test('Owner Dashboard exposes only navigation-effect page controls', () => {
  assert.match(dashboardSource, /const open = \(page: Page\) => setPage\(page\)/);
  assert.equal(
    (dashboardSource.match(/setPage\(/g) ?? []).length,
    1,
    'Dashboard routes every page control through one navigation effect',
  );
  for (const handler of dashboardSource.match(/onClick=\{[^}]*\}/g) ?? []) {
    assert.match(
      handler,
      /open\(|setRange\(/,
      `page control ${handler} must be navigation-only`,
    );
  }
  assert.match(dashboardSource, /onClick=\{\(\) => open\('account'\)\}/);
  assert.match(dashboardSource, />Review Fills </);
  assert.doesNotMatch(dashboardSource, /<button[^>]*type="submit"/);
  assert.doesNotMatch(dashboardSource, /method:\s*['"]POST['"]/);
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
