import assert from 'node:assert/strict';
import test from 'node:test';

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AttentionQueuePanel } from '../../src/features/systemDashboard/components/AttentionQueuePanel.tsx';
import {
  makeAllComponents,
  makeSnapshot,
} from '../../src/features/systemDashboard/fixtures/builders.ts';

const NOW_MS = 1_752_534_400_000;
globalThis.React = React;

// Deliberately conflicts with the browser's retired exposed-capital/severity
// ranker: the server owns canonical ordering, so the browser must preserve any
// supplied sequence exactly instead of re-sorting it.
const ADVERSARIAL_SUPPLIED_QUEUE_CASES = Object.freeze([
  { entry: {
    componentId: 'engine-supervisor',
    rootComponentId: 'ledger-persistence',
    severity: 'HIGH',
    reasonCodes: ['CPT011_CANONICAL_RANK_1'],
    capitalExposed: false,
    recommendedOperatorAction: 'Inspect canonical rank one.',
  }, componentLabel: 'Engine Supervisor', rootLabel: 'LEDGER PERSISTENCE' },
  { entry: {
    componentId: 'reconciliation',
    rootComponentId: 'execution-coordinator-validate-only',
    severity: 'CRITICAL',
    reasonCodes: ['CPT011_CANONICAL_RANK_2'],
    capitalExposed: true,
    recommendedOperatorAction: 'Inspect canonical rank two.',
  }, componentLabel: 'Reconciliation', rootLabel: 'EXECUTION COORDINATOR VALIDATE ONLY' },
  { entry: {
    componentId: 'capital-supervision',
    rootComponentId: 'volume-engine',
    severity: 'HIGH',
    reasonCodes: ['CPT011_CANONICAL_RANK_3', 'CAPITAL_TRUTH_UNAVAILABLE'],
    capitalExposed: true,
    recommendedOperatorAction: 'Inspect canonical rank three.',
  }, componentLabel: 'Capital Supervision', rootLabel: 'VOLUME ENGINE' },
  { entry: {
    componentId: 'public-spot-source',
    rootComponentId: 'engine-supervisor',
    severity: 'HIGH',
    reasonCodes: ['CPT011_CANONICAL_RANK_4'],
    capitalExposed: false,
    recommendedOperatorAction: 'Inspect canonical rank four.',
  }, componentLabel: 'Public Spot Source', rootLabel: 'ENGINE SUPERVISOR' },
  { entry: {
    componentId: 'basis-engine',
    rootComponentId: 'market-universe',
    severity: 'HIGH',
    reasonCodes: ['CPT011_CANONICAL_RANK_5'],
    capitalExposed: false,
    recommendedOperatorAction: 'Inspect canonical rank five.',
  }, componentLabel: 'Basis Engine', rootLabel: 'MARKET UNIVERSE' },
  { entry: {
    componentId: 'q-inference',
    rootComponentId: 'intelligence-runtime',
    severity: 'HIGH',
    reasonCodes: ['CPT011_CANONICAL_RANK_6', 'Q_CLIENT_NOT_CONFIGURED'],
    capitalExposed: false,
    recommendedOperatorAction: 'Inspect canonical rank six.',
  }, componentLabel: 'Q Inference', rootLabel: 'INTELLIGENCE RUNTIME' },
]);

test('read-only Product Control projection preserves adversarial supplied attention order without controls', () => {
  const snapshot = makeSnapshot({
    now: NOW_MS,
    posture: 'BLOCKED',
    truthLabel: 'SYNTHETIC_ONLY',
    components: makeAllComponents(NOW_MS),
    attentionQueue: ADVERSARIAL_SUPPLIED_QUEUE_CASES.map(({ entry }) => ({
      ...entry,
      reasonCodes: [...entry.reasonCodes],
    })),
  });
  const html = renderToStaticMarkup(React.createElement(AttentionQueuePanel, {
    snapshot,
    busy: false,
  }));
  const sections = html.match(/<section class="sdx-section" aria-label="Attention queue">[\s\S]*?<\/section>/g) ?? [];

  assert.equal(sections.length, 1);
  const [attention] = sections;
  assert.match(attention, /<h2>Attention Queue<\/h2>/);
  assert.match(attention, />6 items · canonical supervisor order</);
  assert.equal(
    (attention.match(/class="sdx-attn"/g) ?? []).length,
    ADVERSARIAL_SUPPLIED_QUEUE_CASES.length,
  );

  let previousPosition = -1;
  for (const [index, { entry, componentLabel, rootLabel }] of ADVERSARIAL_SUPPLIED_QUEUE_CASES.entries()) {
    const rankMarker = `CPT011_CANONICAL_RANK_${index + 1}`;
    const position = attention.indexOf(rankMarker);
    assert.ok(position > previousPosition, `${rankMarker} was not rendered in canonical supplied order`);
    previousPosition = position;
    assert.match(attention, new RegExp(`>${componentLabel}`));
    assert.match(attention, new RegExp(`CASCADE OF ${rootLabel}`));
    assert.match(attention, new RegExp(`>${entry.severity}<`));
    for (const reasonCode of entry.reasonCodes) assert.match(attention, new RegExp(`>${reasonCode}<`));
    assert.match(attention, new RegExp(entry.recommendedOperatorAction));
  }

  assert.equal((attention.match(/CAPITAL EXPOSED/g) ?? []).length, 2);
  assert.equal((attention.match(/>CRITICAL</g) ?? []).length, 1);
  assert.equal((attention.match(/>HIGH</g) ?? []).length, 5);
  assert.doesNotMatch(attention, /<button\b|Restart /);

  const interactive = renderToStaticMarkup(React.createElement(AttentionQueuePanel, {
    snapshot,
    busy: false,
    onControl: () => assert.fail('SSR must not invoke a control callback'),
  }));
  assert.equal((interactive.match(/<button\b/g) ?? []).length, ADVERSARIAL_SUPPLIED_QUEUE_CASES.length);

  const emptySnapshot = { ...snapshot, operatorAttentionComponentIds: [], attentionQueue: [] };
  const empty = renderToStaticMarkup(React.createElement(AttentionQueuePanel, {
    snapshot: emptySnapshot,
    busy: false,
  }));
  assert.match(empty, /aria-label="Attention queue"/);
  assert.match(empty, /Nothing requires the operator\. An empty queue is a statement, not an absence\./);
  assert.doesNotMatch(empty, /<button\b/);
});
