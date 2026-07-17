import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';

import { DEFAULT_AI_OPS_SHADOW_FIXTURE as snapshot } from '../../../web/src/aiOps/fixture.ts';
import { SourceLine, TrendCard } from '../../../web/src/aiOps/components.tsx';
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
  assert.match(html, /Five Bounded Levels/);
  assert.match(html, /Runtime, Budgets, Work, Recovery/);
  assert.match(html, /Hour \/ day \/ incident spend/);
  assert.match(html, /Sandbox patches \/ approvals/);
  assert.match(html, /Last-known-good \/ rollback/);
  assert.match(html, /aiops-shadow-a4 \/ b5f4c4782237/);
  assert.match(html, /Expected → Discovered → Instrumented → Reporting/);
  assert.match(html, /PRODUCT_ASSURANCE_CANONICAL_READ_OWNER_NOT_CONFIGURED/);
  assert.match(html, /Bounded Trends/);
  assert.match(html, /PT30M \/ PT5M/);
  assert.match(html, /Burn PT5M UNKNOWN \/ PT1H UNKNOWN/);
  assert.match(html, /Forensic Drill-Down/);
  assert.match(html, /Read-Only Correlation References/);
  assert.match(html, /Synthetic UI Probe Projection/);
  assert.match(html, /POST \/api\/refresh/);
  assert.match(html, /PROJECTION_ONLY/);
  for (const posture of ['MISSING', 'SILENT', 'STALE', 'UNKNOWN', 'DEGRADED', 'BLOCKED', 'SYNTHETIC_ONLY']) assert.match(html, new RegExp(posture));
  assert.match(html, /class="sr-icon"/);
});

test('incident workspace renders bounded evidence, abstention, suppression, validation, forensics, and disabled command requests', () => {
  const html = render(IncidentWorkspace);
  assert.match(html, /INCIDENT_OWNER_NOT_CONFIGURED/);
  assert.match(html, /Suppression, Inhibition, Actionability/);
  assert.match(html, /Affected Dependency Path/);
  assert.match(html, /provider-gateway/);
  assert.match(html, /Actionable<\/dt><dd>UNKNOWN/);
  assert.match(html, /Raw \/ Deduplicated<\/dt><dd class="num">8 \/ 7/);
  assert.match(html, /Silence Window<\/dt><dd>UNKNOWN · NO EXPIRY READBACK/);
  assert.match(html, /Critical Reserve<\/dt><dd>UNKNOWN/);
  assert.match(html, /Resource \/ Global Cooldown<\/dt><dd>UNKNOWN \/ UNKNOWN/);
  assert.match(html, /Backoff \/ Jitter<\/dt><dd>UNKNOWN \/ UNKNOWN/);
  assert.match(html, /Raw-Event Escape/);
  assert.match(html, /Pages \/ Incident <strong>UNKNOWN/);
  assert.match(html, /Required Action Receipts · Page Through Discard/);
  assert.match(html, /NO DURABLE RECEIPT/);
  assert.match(html, /Hypotheses And Unknowns/);
  assert.match(html, /Forensic Correlation/);
  assert.match(html, /FIXTURE-FORENSIC-BUNDLE-A4-0001/);
  assert.match(html, /Raw Stream To Model<\/dt><dd>NO/);
  assert.match(html, /Bounded Forensic Artifacts · Owner Projections/);
  assert.match(html, /HASH MISSING · REVISION MISSING · OBSERVATION MISSING/);
  assert.match(html, /Postmortem/);
  assert.match(html, /REQUIRED · NOT_CONFIGURED · Owner MISSING/);
  assert.match(html, /Diagnostic Validation/);
  assert.match(html, /Disposition<\/dt><dd>INCONCLUSIVE/);
  assert.match(html, /Effect Authorized<\/dt><dd>NO/);
  assert.match(html, /Source Hash/);
  assert.match(html, /fixture-otel-envelope-parser-r1 \/ fixture-redaction-r1/);
  assert.match(html, /DETERMINISTIC_FIXTURE_FIELDS/);
  assert.match(html, /UNCALIBRATED/);
  assert.match(html, /STALE_94S \/ SOURCE_AGE_PRECEDES_QUEUE_OBSERVATION_FIXTURE_ONLY/);
  assert.match(html, /EVIDENCE_POINTER/);
  assert.match(html, /TIME_WINDOW/);
  assert.match(html, /VALIDATED/);
  assert.match(html, /INVALIDATED/);
  assert.match(html, /Missing Evidence/);
  assert.match(html, /Conflicting Evidence/);
  assert.match(html, /No operational effect until every required check is VALIDATED/);
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
  assert.match(html, /EVID-FIXTURE-AGE-01/);
  assert.match(html, /GATHER_MORE_EVIDENCE/);
  assert.match(html, /Authority<\/dt><dd>NOT CREATED/);
  assert.match(html, /Drafting is local presentation state/);
  assert.match(html, /Session Lineage/);
  assert.match(html, /FIXTURE-CONTEXT-MANIFEST-A4X-0001/);
  assert.match(html, /INITIAL_SESSION/);
  assert.match(html, /Hidden Memory<\/dt><dd>FORBIDDEN/);
  assert.match(html, /Session Caps<\/dt><dd>32768 prompt bytes · 12 files · 0 children/);
  assert.match(html, /Static And Dynamic Context Manifest/);
  assert.match(html, /FAIL_CLOSED_UNRESOLVED_POINTERS/);
  assert.match(html, /Static Context Hash/);
  assert.match(html, /b5f4c478223796cf7f9d73ba8c424a179aaa8551/);
  assert.match(html, /Prompt \/ Evaluation \/ Provider Qualification/);
  assert.match(html, /fixture-prompt-r1 \/ fixture-eval-r1 \/ UNMOUNTED/);
  assert.match(html, /Evidence \/ Age Ceiling/);
  assert.match(html, /30000 ms/);
  assert.match(html, /MISSION\.md/);
  assert.match(html, /UNRESOLVED/);
  assert.match(html, /Tools \/ Write Scope<\/dt><dd>NONE \/ NONE/);
  assert.match(html, /Stop \/ Next Owner/);
  assert.match(html, /Chat context is not memory, authority, or durable evidence/);
  const sendButton = buttons(html).find((button) => button.text === 'NOT_WIRED');
  assert.ok(sendButton);
  assert.match(sendButton.attributes, /\bdisabled=""/);
});

test('permissions render the exact specification count, triple readback, emergency kill, hard denials, and disable-only bulk posture', () => {
  const html = render(PermissionsConsole);
  assert.match(html, /12 Categories × 10/);
  assert.match(html, /AI_OPS\.A01/);
  assert.match(html, /AI_OPS\.A10/);
  assert.match(html, /Requested/);
  assert.match(html, /Effective/);
  assert.match(html, /Readback/);
  assert.match(html, /Bulk Disable · NOT_WIRED/);
  assert.match(html, /diagnostic-plane\.kill/);
  assert.match(html, /SET_DIAGNOSTIC_PLANE_KILL/);
  assert.match(html, /Desired \/ Requested<\/dt><dd>ENGAGED \/ ENGAGED/);
  assert.match(html, /Request Status<\/dt><dd>LOCAL_FIXTURE_ONLY/);
  assert.match(html, /Effective \/ Readback<\/dt><dd>UNKNOWN \/ UNKNOWN/);
  assert.match(html, /Readback Agreement<\/dt><dd>UNKNOWN/);
  assert.match(html, /Effect \/ Readback Handler<\/dt><dd>MISSING \/ MISSING/);
  assert.match(html, /Financial Kill Alias<\/dt><dd>FALSE/);
  assert.match(html, /Self Re-Enable<\/dt><dd>FORBIDDEN/);
  assert.match(html, /Emergency Kill Effective-State Proof/);
  assert.match(html, /Provider egress closed/);
  assert.match(html, /Evidence Retention/);
  assert.match(html, /Hard Denials Remain Unreachable/);
  assert.match(html, /DIRECT_ORDER_ACTION/);
  assert.match(html, /UNKNOWN — NO SERVER ENVELOPE/);
  for (const actionText of ['ENGAGE · NOT_WIRED', 'Bulk Disable · NOT_WIRED', 'Preview Request Only']) {
    const action = buttons(html).find((button) => button.text === actionText);
    assert.ok(action, actionText);
    assert.match(action.attributes, /\bdisabled=""/, actionText);
  }
  assert.match(html, /role="radio"[^>]*aria-checked="true"[^>]*tabindex="0"/);
  assert.doesNotMatch(html, /<(?:select|option)\b/i);
  const inspectButtons = buttons(html).filter((button) => button.text === 'Inspect');
  assert.equal(inspectButtons.length, 10);
  assert.equal(new Set(inspectButtons.map((button) => button.attributes.match(/aria-label="([^"]+)"/)?.[1])).size, 10);
  assert.ok(inspectButtons.every((button) => /aria-label="Inspect AI_OPS\.A(?:0[1-9]|10) — /.test(button.attributes)));
  assert.doesNotMatch(html, /enable all/i);
  assert.doesNotMatch(html, />resume</i);
});

test('governance renders all five manifest families, isolated identities, mode and reasoning ladders, and missing graduation proof', () => {
  const html = render(GovernanceView);
  for (const family of ['CLASSIFICATION', 'RUNBOOK', 'POLICY', 'PROVIDER', 'CAPABILITY']) assert.match(html, new RegExp(family));
  for (const role of ['Runtime Diagnostician', 'Engineering Repair Worker', 'Independent Verification Worker', 'Research / Trade Context Advisor']) assert.match(html, new RegExp(role));
  assert.match(html, /More Reasoning Budget Is Not More Authority/);
  assert.match(html, /BOUNDED_AUTOREMEDIATE/);
  assert.match(html, /DIAGNOSTIC_PLANE_UNAVAILABLE/);
  assert.match(html, /SUBSCRIPTION_CODEX_WORKER/);
  assert.match(html, /SUBSCRIPTION_CLAUDE_CODE_WORKER/);
  assert.match(html, /fixture-provider\.invalid/);
  assert.match(html, /must not fall back to API billing or another account/);
  assert.match(html, /FIXTURE-CHATGPT_MANAGED-AUTH|FIXTURE_CHATGPT_MANAGED_AUTH/);
  assert.match(html, /No numerical graduation record or accepted effect owner/);
  assert.match(html, /NO_GRADUATION_EVIDENCE/);
  assert.match(html, /Numerical Bars Before Exact-Scope Promotion/);
  assert.match(html, /NO_PROMOTION/);
  assert.match(html, /Required 100 · Observed 12/);
  assert.match(html, /Independent Reviewer <strong>MISSING/);
  assert.match(html, /Demotion Triggers/);
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
  assert.match(html, /<h2 id="aiox-safety-title">Immediate Safety Posture<\/h2>/);
});

test('trend rendering leaves explicit gaps instead of fabricating null samples', () => {
  const html = renderToStaticMarkup(createElement(TrendCard, {
    series: {
      seriesId: 'fixture-null-gap',
      label: 'Null gap proof',
      unit: 'count',
      metricFamily: 'INCIDENT',
      percentile: 'NONE',
      window: 'PT2M',
      resolution: 'PT1M',
      sampleLimit: 3,
      shortWindow: 'PT30S',
      longWindow: 'PT5M',
      alertClass: 'INFORMATIONAL',
      shortWindowBurn: null,
      longWindowBurn: null,
      drilldownLimit: 1,
      drilldownRefs: ['fixture:incident:null-gap'],
      posture: 'SYNTHETIC_ONLY',
      samples: [
        { at: '2026-07-14T12:00:00.000Z', value: 1 },
        { at: '2026-07-14T12:01:00.000Z', value: null },
        { at: '2026-07-14T12:02:00.000Z', value: 3 },
        { at: '2026-07-14T12:03:00.000Z', value: 99 },
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
  assert.doesNotMatch(html, />undefined</);
  assert.match(html, /2 of 3 bounded samples known; 4 supplied with limit 3; rising trajectory; range 1 to 3 count/);
  assert.match(html, /from 2026-07-14T12:00:00.000Z to 2026-07-14T12:02:00.000Z; latest 3 count; sample window PT2M; resolution PT1M; burn windows PT30S and PT5M; alert INFORMATIONAL/);
  assert.match(html, /2026-07-14T12:01:00.000Z<\/time><strong class="num">UNKNOWN/);
  assert.doesNotMatch(html, /2026-07-14T12:03:00.000Z/);
  assert.doesNotMatch(html, />99 count</);
  assert.match(html, /Forensic Drill-Down/);
  assert.match(html, /3 Samples · Limit 3/);
  assert.match(html, /fixture:incident:null-gap/);
});

test('missing selected incident fails closed instead of falling back to a different case', () => {
  const hostileSnapshot = { ...snapshot, selectedCaseId: 'FIXTURE-CASE-A4-MISSING' };
  const html = renderToStaticMarkup(createElement(IncidentWorkspace, { snapshot: hostileSnapshot }));
  assert.match(html, /data-selected-case-state="missing"/);
  assert.match(html, /SELECTED_INCIDENT_NOT_FOUND/);
  assert.match(html, /FIXTURE-CASE-A4-MISSING/);
  assert.match(html, /1 fixture incident supplied/);
  assert.equal(html.includes(snapshot.incidents[0].title), false);
});

test('workspace and permission summaries derive counts from the supplied snapshot', () => {
  const narrowedSnapshot = { ...snapshot, controls: snapshot.controls.slice(0, 3) };
  const html = renderToStaticMarkup(createElement(PermissionsConsole, { snapshot: narrowedSnapshot }));
  assert.match(html, /These 3 rows are the directive/);
  assert.match(html, /<span>Spec Rows<\/span><strong class="num">3<\/strong>/);
  assert.match(html, /1 Categories × 3/);
  assert.doesNotMatch(html, /These 120 rows are the directive/);

  const workspaceSource = readFileSync(new URL('../../../web/src/aiOps/AiOpsWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspaceSource, /item\.id === 'permissions'.*snapshot\.controls\.length/);
  assert.doesNotMatch(workspaceSource, /item\.id === 'permissions'[^\n]+>120</);
});

test('source lines render complete provenance and explicit missing provenance', () => {
  const complete = renderToStaticMarkup(createElement(SourceLine, { source: {
    owner: 'A4 fixture owner',
    sourceId: 'fixture:source-line',
    revision: 'fixture-r7',
    observedAt: '2026-07-14T12:00:00.000Z',
    wiring: 'FIXTURE_ONLY',
  } }));
  assert.match(complete, /fixture-r7/);
  assert.match(complete, /<time dateTime="2026-07-14T12:00:00.000Z">2026-07-14T12:00:00.000Z<\/time>/);
  assert.match(complete, /FIXTURE_ONLY/);

  const missing = renderToStaticMarkup(createElement(SourceLine, { source: {
    owner: 'Unfinished owner',
    sourceId: 'fixture:missing-provenance',
    revision: null,
    observedAt: null,
    wiring: 'PENDING_BACKEND',
  } }));
  assert.match(missing, /REVISION MISSING/);
  assert.match(missing, /OBSERVATION MISSING/);
  assert.match(missing, /PENDING_BACKEND/);
});

test('trend rendering normalizes non-finite values and enforces absolute DOM ceilings', () => {
  const samples = Array.from({ length: 140 }, (_, index) => ({
    at: `fixture-at-${index}`,
    value: index === 0 ? Number.NaN : index === 1 ? Number.POSITIVE_INFINITY : index === 2 ? Number.NEGATIVE_INFINITY : index,
  }));
  const series = {
    ...snapshot.trends[0],
    seriesId: 'fixture-hostile-bounds',
    label: 'Hostile Bounds',
    sampleLimit: Number.MAX_SAFE_INTEGER,
    drilldownLimit: Number.MAX_SAFE_INTEGER,
    drilldownRefs: Array.from({ length: 40 }, (_, index) => `fixture:ref:${index}`),
    samples,
  };
  const html = renderToStaticMarkup(createElement(TrendCard, { series }));
  assert.equal((html.match(/<time dateTime="fixture-at-/g) ?? []).length, 120);
  assert.equal((html.match(/fixture:ref:/g) ?? []).length, 24);
  assert.match(html, /117 of 120 bounded samples known; 140 supplied with limit 120/);
  assert.match(html, /120 Samples · Limit 120/);
  assert.match(html, /Read-Only Correlation References · Limit 24/);
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /<polyline/);

  const invalidLimit = renderToStaticMarkup(createElement(TrendCard, {
    series: { ...series, sampleLimit: Number.POSITIVE_INFINITY, drilldownLimit: Number.NaN },
  }));
  assert.equal((invalidLimit.match(/<time dateTime="fixture-at-/g) ?? []).length, 0);
  assert.equal((invalidLimit.match(/fixture:ref:/g) ?? []).length, 0);
  assert.match(invalidLimit, /0 Samples · Limit 0/);
  assert.doesNotMatch(invalidLimit, /NaN|Infinity/);
});
