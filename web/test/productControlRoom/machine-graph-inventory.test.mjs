import assert from 'node:assert/strict';
import test from 'node:test';

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SYSTEM_COMPONENT_IDS } from '../../../server/src/systemIntegration/contracts/constants.ts';
import { MachineGraph } from '../../src/features/systemDashboard/components/MachineGraph.tsx';
import {
  makeAllComponents,
  makeSnapshot,
} from '../../src/features/systemDashboard/fixtures/builders.ts';
import {
  EXPECTED_COMPONENTS,
  traceStage,
} from '../../src/features/systemDashboard/lib/presentation.ts';
import {
  buildFixtureBinding,
  createFixtureSession,
} from '../../src/lib/productIntegration/model.ts';

const NOW_MS = 1_752_534_400_000;
globalThis.React = React;

function renderInventory({ omit = [], overrides = {} } = {}) {
  const components = makeAllComponents(NOW_MS, overrides, omit);
  const snapshot = makeSnapshot({
    now: NOW_MS,
    posture: 'STOPPED',
    truthLabel: 'SYNTHETIC_ONLY',
    components,
  });
  return {
    components,
    html: renderToStaticMarkup(React.createElement(MachineGraph, { snapshot })),
  };
}

test('machine graph renders the complete fourteen-component canonical inventory including Q inference', () => {
  assert.deepEqual(EXPECTED_COMPONENTS, SYSTEM_COMPONENT_IDS);
  assert.equal(traceStage('q-inference'), 'Assessment');

  const { components, html } = renderInventory();
  assert.equal(components.length, 14);
  const q = components.find((component) => component.componentId === 'q-inference');
  assert.equal(q?.owner, 'Q_INFERENCE');
  assert.equal(q?.ownerPath, 'quant/src/quant_edge/inference');
  assert.deepEqual(q?.dependencies, ['market-intelligence']);
  assert.match(html, /14 reported · 0 missing/);
  assert.match(html, /aria-label="Q Inference"/);
  assert.doesNotMatch(html, /aria-label="Q Inference missing"/);
});

test('machine graph renders Q inference as explicitly missing when the supervisor omits it', () => {
  const { components, html } = renderInventory({ omit: ['q-inference'] });
  assert.equal(components.length, 13);
  assert.match(html, /13 reported · 1 missing/);
  assert.match(html, /aria-label="Q Inference missing"/);
  assert.match(html, /COMPONENT_ABSENT/);
});

test('server-shaped unavailable Q inference truth stays blocked, unknown-age, and non-green', () => {
  const { html } = renderInventory({
    overrides: {
      'q-inference': {
        releaseStatuses: ['BUILT_AND_TESTED', 'IMPORTED', 'NOT_CONFIGURED'],
        truthLabel: 'UNAVAILABLE',
        desiredState: 'RUNNING',
        phase: 'NOT_CONFIGURED',
        domainObservedState: null,
        readiness: 'BLOCKED',
        completeness: 'UNAVAILABLE',
        sourceTimestamp: null,
        freshness: null,
        lastReceiveAtMs: null,
        lastProcessAtMs: null,
        lastSuccessAtMs: null,
        blockerCodes: ['Q_CLIENT_NOT_CONFIGURED'],
        supportedControls: [],
      },
    },
  });
  const start = html.indexOf('aria-label="Q Inference"');
  const qHtml = html.slice(start, html.indexOf('</article>', start));
  assert.ok(start >= 0);
  assert.match(qHtml, /UNAVAILABLE/);
  assert.match(qHtml, /sdx-chip bad/);
  assert.match(qHtml, />BLOCKED</);
  assert.match(qHtml, /sdx-age idle">UNKNOWN/);
  assert.match(qHtml, /Q_CLIENT_NOT_CONFIGURED/);
  assert.doesNotMatch(qHtml, /sdx-chip ok/);
});

test('Product fixture binding carries fourteen unique canonical components including Q inference', () => {
  const session = createFixtureSession('HEALTHY_OBSERVE', 'cpt010-regression', NOW_MS);
  const fixture = buildFixtureBinding(session, {});
  const ids = fixture.components.map((component) => component.componentId);
  assert.equal(ids.length, 14);
  assert.equal(new Set(ids).size, 14);
  assert.ok(ids.includes('q-inference'));
});
