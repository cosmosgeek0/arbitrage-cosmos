import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CapitalPanel } from '../../src/features/systemDashboard/components/CapitalPanel.tsx';
import { ExposureBanner } from '../../src/features/systemDashboard/components/PostureStrip.tsx';
import { RiskExecutionPanel } from '../../src/features/systemDashboard/components/RiskExecutionPanel.tsx';
import { TraceDrilldown } from '../../src/features/systemDashboard/components/TraceDrilldown.tsx';
import { fixtureById } from '../../src/features/systemDashboard/fixtures/index.ts';
import {
  exposureVerdict,
  reconciliationVerdict,
} from '../../src/features/systemDashboard/lib/presentation.ts';

globalThis.React = React;

test('unknown exposure never becomes no exposure, hidden truth, or a zero count', () => {
  assert.deepEqual(exposureVerdict(null, null), { kind: 'UNKNOWN', count: null, amount: null });
  assert.deepEqual(exposureVerdict(null, '125.00'), { kind: 'ACTIVE', count: null, amount: '125.00' });
  assert.deepEqual(exposureVerdict(0, '0'), { kind: 'NONE', count: 0, amount: '0' });

  const warming = fixtureById('warming').build(1_800_000_000_000);
  const warmingMarkup = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(ExposureBanner, { snapshot: warming }),
    React.createElement(CapitalPanel, { snapshot: warming }),
  ));
  assert.match(warmingMarkup, /EXPOSURE UNKNOWN/);
  assert.doesNotMatch(warmingMarkup, /No open exposure|0 active exposures/);

  const activeUnknownCount = {
    ...warming,
    summaries: {
      ...warming.summaries,
      capital: {
        ...warming.summaries.capital,
        activeExposureAmount: '125.00',
        activeExposureCount: null,
      },
    },
  };
  const activeMarkup = renderToStaticMarkup(
    React.createElement(ExposureBanner, { snapshot: activeUnknownCount }),
  );
  assert.match(activeMarkup, /Capital Exposed · 125.00/);
  assert.match(activeMarkup, /UNKNOWN active exposures/);
  assert.doesNotMatch(activeMarkup, /0 active exposures/);
});

test('reconciliation is clear only when current available evidence explicitly converged', () => {
  const now = 1_800_000_000_000;
  const warming = fixtureById('warming').build(now);
  assert.equal(reconciliationVerdict(warming), 'UNKNOWN');
  const warmingMarkup = renderToStaticMarkup(
    React.createElement(RiskExecutionPanel, { snapshot: warming, nowMs: now, onTrace: () => {} }),
  );
  assert.match(warmingMarkup, /RECONCILIATION UNKNOWN/);
  assert.doesNotMatch(warmingMarkup, />CLEAR</);

  const healthy = fixtureById('healthy').build(now);
  assert.equal(reconciliationVerdict(healthy), 'CLEAR');
  const healthyMarkup = renderToStaticMarkup(
    React.createElement(RiskExecutionPanel, { snapshot: healthy, nowMs: now, onTrace: () => {} }),
  );
  assert.match(healthyMarkup, />CLEAR</);

  const stale = {
    ...healthy,
    components: healthy.components.map((component) => component.componentId === 'reconciliation'
      ? { ...component, freshness: { state: 'STALE', ageMs: 120_000, evaluatedAt: now } }
      : component),
  };
  assert.equal(reconciliationVerdict(stale), 'UNKNOWN');
});

test('narrow trace layout preserves failure and provenance truth', () => {
  const now = 1_800_000_000_000;
  const snapshot = fixtureById('healthy').build(now);
  const failedTrace = snapshot.recentCorrelatedDecisions.find((trace) => trace.failureCode !== null);
  assert.ok(failedTrace);
  const markup = renderToStaticMarkup(React.createElement(TraceDrilldown, {
    snapshot,
    nowMs: now,
    selectedCorrelationId: failedTrace.correlationId,
    onSelect: () => {},
  }));
  assert.match(markup, new RegExp(failedTrace.failureCode));
  assert.match(markup, new RegExp(failedTrace.truthLabel.replaceAll('_', ' ')));

  const css = readFileSync(new URL(
    '../../src/features/systemDashboard/styles/systemDashboard.css',
    import.meta.url,
  ), 'utf8');
  const narrowRule = css.match(/@container \(max-width: 660px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.doesNotMatch(narrowRule, /\.sdx-chain-end\s*\{[^}]*display\s*:\s*none/);
  assert.match(narrowRule, /\.sdx-chain-end\s*\{[^}]*grid-column\s*:\s*2/);
});
