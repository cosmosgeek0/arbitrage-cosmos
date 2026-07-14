import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';

import { DEFAULT_AI_OPS_SHADOW_FIXTURE as snapshot } from '../../../web/src/aiOps/fixture.ts';
import { TrendCard } from '../../../web/src/aiOps/components.tsx';
import { GovernanceView } from '../../../web/src/aiOps/views/GovernanceView.tsx';
import { IncidentWorkspace } from '../../../web/src/aiOps/views/IncidentWorkspace.tsx';
import { OverviewView } from '../../../web/src/aiOps/views/OverviewView.tsx';
import { OwnerChat } from '../../../web/src/aiOps/views/OwnerChat.tsx';
import { PermissionsConsole } from '../../../web/src/aiOps/views/PermissionsConsole.tsx';

// The root test runner has no root tsconfig, so its TSX loader uses the classic
// transform for shared house primitives. Production Vite uses web/tsconfig.json.
globalThis.React = React;

function render(Component) {
  return renderToStaticMarkup(createElement(Component, { snapshot }));
}

function buttons(html) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    attributes: match[1],
    text: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }));
}

test('overview renders explicit shadow truth, five levels, owner inventory, trends, probes, and RefreshDock projection', () => {
  const html = render(OverviewView);
  assert.match(html, /SHADOW_SPECULATIVE/);
  assert.match(html, /Canonical Product Assurance, incident, provider, permission, probe, and chat owners are unfinished/);
  assert.match(html, /L1_IMMEDIATE_SAFETY_VIEW/);
  assert.match(html, /Five bounded levels/);
  assert.match(html, /Runtime, budgets, work, recovery/);
  assert.match(html, /Hour \/ day \/ incident spend/);
  assert.match(html, /Sandbox patches \/ approvals/);
  assert.match(html, /Last-known-good \/ rollback/);
  assert.match(html, /aiops-shadow-a4 \/ 03857dcdaff8/);
  assert.match(html, /Expected → discovered → instrumented → reporting/);
  assert.match(html, /PRODUCT_ASSURANCE_CANONICAL_READ_OWNER_NOT_CONFIGURED/);
  assert.match(html, /Bounded trends/);
  assert.match(html, /Synthetic UI probe projection/);
  assert.match(html, /POST \/api\/refresh/);
  assert.match(html, /PROJECTION_ONLY/);
  for (const posture of ['MISSING', 'SILENT', 'STALE', 'UNKNOWN', 'DEGRADED', 'BLOCKED', 'SYNTHETIC_ONLY']) assert.match(html, new RegExp(posture));
  assert.match(html, /class="sr-icon"/);
});

test('incident workspace renders bounded evidence, abstention, suppression, validation, forensics, and disabled command requests', () => {
  const html = render(IncidentWorkspace);
  assert.match(html, /INCIDENT_OWNER_NOT_CONFIGURED/);
  assert.match(html, /Suppression, inhibition, actionability/);
  assert.match(html, /Affected dependency path/);
  assert.match(html, /provider-gateway/);
  assert.match(html, /Actionable<\/dt><dd>UNKNOWN/);
  assert.match(html, /Hypotheses and unknowns/);
  assert.match(html, /Forensic correlation/);
  assert.match(html, /Diagnostic validation/);
  assert.match(html, /GATHER_MORE_EVIDENCE/);
  assert.match(html, /OPEN_ISOLATED_REPAIR/);
  const commandButtons = buttons(html).filter((button) => button.text === 'NOT_WIRED');
  assert.equal(commandButtons.length, 8);
  assert.ok(commandButtons.every((button) => /\bdisabled=""/.test(button.attributes)));
  assert.match(html, /Authority created: false/);
});

test('owner chat is an evidence-cited synthetic log with a local draft and no send path', () => {
  const html = render(OwnerChat);
  assert.match(html, /role="log"/);
  assert.match(html, /SYNTHETIC_ONLY transcript/);
  assert.match(html, /No provider API, personal ChatGPT tab, session store/);
  assert.match(html, /EVID-FIXTURE-AGE-01@2026-07-14T12:00:00.000Z/);
  assert.match(html, /GATHER_MORE_EVIDENCE/);
  assert.match(html, /Authority<\/dt><dd>NOT CREATED/);
  assert.match(html, /Drafting is local presentation state/);
  assert.match(html, /Session lineage/);
  assert.match(html, /Chat context is not memory, authority, or durable evidence/);
  const sendButton = buttons(html).find((button) => button.text === 'NOT_WIRED');
  assert.ok(sendButton);
  assert.match(sendButton.attributes, /\bdisabled=""/);
});

test('permissions render the exact specification count, triple readback, emergency kill, hard denials, and disable-only bulk posture', () => {
  const html = render(PermissionsConsole);
  assert.match(html, /12 categories × 10/);
  assert.match(html, /AI_OPS\.A01/);
  assert.match(html, /AI_OPS\.A10/);
  assert.match(html, /Requested/);
  assert.match(html, /Effective/);
  assert.match(html, /Readback/);
  assert.match(html, /Bulk disable · NOT_WIRED/);
  assert.match(html, /diagnostic-plane\.kill/);
  assert.match(html, /SET_DIAGNOSTIC_PLANE_KILL/);
  assert.match(html, /Self re-enable<\/dt><dd>FORBIDDEN/);
  assert.match(html, /Hard denials remain unreachable/);
  assert.match(html, /DIRECT_ORDER_ACTION/);
  assert.match(html, /UNKNOWN — NO SERVER ENVELOPE/);
  for (const actionText of ['ENGAGE · NOT_WIRED', 'Bulk disable · NOT_WIRED', 'Preview request only']) {
    const action = buttons(html).find((button) => button.text === actionText);
    assert.ok(action, actionText);
    assert.match(action.attributes, /\bdisabled=""/, actionText);
  }
  assert.match(html, /role="radio"[^>]*aria-checked="true"[^>]*tabindex="0"/);
  assert.doesNotMatch(html, /enable all/i);
  assert.doesNotMatch(html, />resume</i);
});

test('governance renders all five manifest families, isolated identities, mode and reasoning ladders, and missing graduation proof', () => {
  const html = render(GovernanceView);
  for (const family of ['CLASSIFICATION', 'RUNBOOK', 'POLICY', 'PROVIDER', 'CAPABILITY']) assert.match(html, new RegExp(family));
  for (const role of ['Runtime Diagnostician', 'Engineering Repair Worker', 'Independent Verification Worker', 'Research / Trade Context Advisor']) assert.match(html, new RegExp(role));
  assert.match(html, /More reasoning budget is not more authority/);
  assert.match(html, /BOUNDED_AUTOREMEDIATE/);
  assert.match(html, /No credential, subscription authentication, provider call, or fallback is configured/i);
  assert.match(html, /Required evidence before capability promotion/);
  assert.match(html, /NO_GRADUATION_EVIDENCE/);
});

test('no surface emits an unqualified accepted or live-ready claim', () => {
  const html = [OverviewView, IncidentWorkspace, OwnerChat, PermissionsConsole, GovernanceView].map(render).join('\n');
  assert.doesNotMatch(html, /PRESTAGE_READY/);
  assert.doesNotMatch(html, /INTEGRATED_ACCEPTED/);
  assert.doesNotMatch(html, /AI_OPS_(?:SHADOW|ADVISE|SANDBOX_PATCH|BOUNDED_CLASS_A)_ACCEPTED/);
  assert.doesNotMatch(html, /provider connected/i);
  assert.doesNotMatch(html, />\s*(?:READY|OK)\s*</);
  assert.doesNotMatch(html, /accepted owner truth|signed manifest projection/i);
  assert.match(html, /aria-labelledby="aiox-safety-title"/);
  assert.match(html, /<h2 id="aiox-safety-title">Immediate safety posture<\/h2>/);
});

test('trend rendering leaves explicit gaps instead of fabricating null samples', () => {
  const html = renderToStaticMarkup(createElement(TrendCard, {
    series: {
      seriesId: 'fixture-null-gap',
      label: 'Null gap proof',
      unit: 'count',
      posture: 'SYNTHETIC_ONLY',
      samples: [
        { at: '2026-07-14T12:00:00.000Z', value: 1 },
        { at: '2026-07-14T12:01:00.000Z', value: null },
        { at: '2026-07-14T12:02:00.000Z', value: 3 },
      ],
      source: {
        owner: 'A4 test fixture',
        sourceId: 'fixture:null-gap',
        revision: 'fixture-r1',
        observedAt: '2026-07-14T12:02:00.000Z',
        wiring: 'FIXTURE_ONLY',
      },
    },
  }));
  assert.doesNotMatch(html, /<polyline/);
  assert.match(html, /2 of 3 samples known; rising trajectory; range 1 to 3 count/);
  assert.match(html, /from 2026-07-14T12:00:00.000Z to 2026-07-14T12:02:00.000Z; latest 3 count; missing samples render as gaps/);
});
