import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

import { RiskExecutionPanel } from '../../src/features/systemDashboard/components/RiskExecutionPanel.tsx';
import { makeAllComponents, makeSnapshot, makeTrace } from '../../src/features/systemDashboard/fixtures/builders.ts';

const NOW = 1_900_000_000_000;
globalThis.React = React;

test('risk panel renders NEEDS_REVIEW as non-authorizing unknown truth with decisive human evidence', () => {
  const snapshot = makeSnapshot({
    now: NOW,
    posture: 'DEGRADED',
    truthLabel: 'SYNTHETIC_ONLY',
    components: makeAllComponents(NOW),
    summaries: {
      risk: {
        truthLabel: 'DRY_RUN',
        latestVerdict: 'NEEDS_REVIEW',
        latestVerdictAtMs: NOW - 1_000,
        latestVerdictId: 'risk-review-1',
        correlationId: 'corr-risk-review-1',
        maxAllowedSize: null,
        requiredConfirmation: true,
        decisiveInputSnapshot: [{
          code: 'ACCOUNT_TRUTH',
          status: 'UNKNOWN',
          detail: 'Account truth is unavailable; the plan remains blocked.',
          observed: null,
          limit: null,
          evidenceTimestamp: null,
        }],
        rejectionCount: 0,
        reasonCodes: ['ACCOUNT_TRUTH'],
      },
    },
  });
  const html = renderToStaticMarkup(React.createElement(RiskExecutionPanel, {
    snapshot,
    nowMs: NOW,
    onTrace() {},
  }));
  assert.match(html, /NEEDS_REVIEW/);
  assert.match(html, /Verdict-Scoped Maximum/);
  assert.match(html, /UNKNOWN/);
  assert.match(html, /Required Confirmation/);
  assert.match(html, /confirmation does not override allowed=false/);
  assert.match(html, /ACCOUNT_TRUTH: Account truth is unavailable; the plan remains blocked\./);
  assert.doesNotMatch(html, />0 USD</);
});

test('risk panel discloses every bounded decisive input and labels the compact overflow count', () => {
  const checks = Array.from({ length: 5 }, (_, index) => ({
    code: `CHECK_${index + 1}`,
    status: 'UNKNOWN',
    detail: `Human reason ${index + 1}`,
    observed: index === 4 ? 'observed-five' : null,
    limit: index === 4 ? 'limit-five' : null,
    evidenceTimestamp: index === 4 ? NOW - 5_000 : null,
  }));
  const snapshot = makeSnapshot({
    now: NOW,
    posture: 'DEGRADED',
    truthLabel: 'SYNTHETIC_ONLY',
    components: makeAllComponents(NOW),
    summaries: { risk: {
      truthLabel: 'DRY_RUN', latestVerdict: 'NEEDS_REVIEW', latestVerdictAtMs: NOW - 1_000,
      latestVerdictId: 'risk-review-many', correlationId: 'corr-risk-review-many', maxAllowedSize: null,
      requiredConfirmation: true, decisiveInputSnapshot: checks, rejectionCount: 0,
      reasonCodes: checks.map((check) => check.code),
    } },
  });
  const html = renderToStaticMarkup(React.createElement(RiskExecutionPanel, { snapshot, nowMs: NOW, onTrace() {} }));
  assert.match(html, /\+2 MORE/);
  assert.match(html, /Inspect full decisive snapshot · 5 inputs/);
  assert.match(html, /CHECK_5/);
  assert.match(html, /Human reason 5/);
  assert.match(html, /observed-five/);
  assert.match(html, /limit-five/);
});

test('risk trace never infers a replacement correlation when canonical correlation truth is absent', () => {
  const snapshot = makeSnapshot({
    now: NOW,
    posture: 'DEGRADED',
    truthLabel: 'SYNTHETIC_ONLY',
    components: makeAllComponents(NOW),
    summaries: { risk: { correlationId: null } },
    recentCorrelatedDecisions: [makeTrace(NOW, {
      componentId: 'multileg-risk', kind: 'verdict-approve', correlationId: 'corr-inferred-wrong',
      referenceIds: ['verdict-01J9ZK'],
    })],
  });
  const html = renderToStaticMarkup(React.createElement(RiskExecutionPanel, { snapshot, nowMs: NOW, onTrace() {} }));
  assert.equal((html.match(/>Trace<\/button>/g) ?? []).length, 0, 'the reference lookup cannot replace missing canonical risk correlation truth');
});

test('expanded risk evidence never hides or ellipsizes bounded observed and limit text', () => {
  const css = readFileSync(new URL('../../src/features/systemDashboard/styles/systemDashboard.css', import.meta.url), 'utf8');
  const rule = css.match(/\.sdx-risk-evidence-item dd\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.notEqual(rule, '', 'the full evidence value rule must remain explicit');
  assert.match(rule, /overflow-wrap:\s*anywhere/);
  assert.match(rule, /white-space:\s*normal/);
  assert.doesNotMatch(rule, /overflow:\s*hidden|text-overflow:\s*ellipsis|white-space:\s*nowrap/);
});
