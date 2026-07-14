import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canonicalComponentPresentation,
  canonicalKillSwitchEngagePosture,
  canonicalRefreshTargetPosture,
  canonicalStrategyRuntimePresentation,
  canonicalWatchmanOverallPresentation,
} from '../../src/lib/canonicalCockpitTruth.ts';

const component = (overrides = {}) => ({
  componentId: 'basis-engine',
  owner: 'BasisEngine:server/src/engine/basis',
  desiredLifecycle: 'READY',
  observedLifecycle: 'READY',
  capability: 'DRY_RUN',
  heartbeatAtMs: 1_800_000_000_000,
  lastAdvanceAtMs: 1_800_000_000_000,
  sourceAgeMs: 10,
  eventAgeMs: 10,
  processingAgeMs: 10,
  queueDepth: 0,
  queueCapacity: 128,
  droppedCount: 0,
  blockerCode: null,
  rootCauseComponentId: null,
  capitalRelevance: 'POTENTIAL',
  supportedControlIds: [],
  correlationId: null,
  truthLabel: 'BUILT_AND_TESTED',
  ...overrides,
});

test('READY plus DRY_RUN stays non-green and exposes lifecycle, capability, and truth separately', () => {
  const posture = canonicalComponentPresentation(component(), 'PROVEN');
  assert.equal(posture.status, 'degraded');
  assert.equal(posture.tone, 'warn');
  assert.equal(posture.statusLabel, 'Validate Only');
  assert.equal(posture.lifecycle, 'READY');
  assert.equal(posture.capability, 'DRY_RUN');
  assert.equal(posture.truthLabel, 'BUILT_AND_TESTED');
  assert.match(posture.stateLabel, /READY · VALIDATE ONLY · BUILT AND TESTED/);
});

test('green requires the exact READY plus LIVE_PUBLIC capability and truth triple', () => {
  assert.equal(canonicalComponentPresentation(component({ capability: 'LIVE_PUBLIC' }), 'PROVEN').status, 'degraded');
  assert.equal(canonicalComponentPresentation(component({ truthLabel: 'LIVE_PUBLIC' }), 'PROVEN').status, 'degraded');
  assert.equal(canonicalComponentPresentation(component({ capability: 'LIVE_PUBLIC', truthLabel: 'LIVE_PUBLIC' }), 'UNPROVEN').status, 'outage');
  const live = canonicalComponentPresentation(component({ capability: 'LIVE_PUBLIC', truthLabel: 'LIVE_PUBLIC' }), 'PROVEN');
  assert.equal(live.status, 'operational');
  assert.equal(live.tone, 'ok');
  assert.equal(live.statusLabel, 'Live Public');
});

test('NOT_CONFIGURED and missing canonical components cannot become healthy', () => {
  const ownerGated = canonicalComponentPresentation(component({ capability: 'NOT_CONFIGURED', truthLabel: 'NOT_CONFIGURED' }), 'PROVEN');
  assert.equal(ownerGated.status, 'planned');
  assert.equal(ownerGated.tone, 'warn');
  assert.equal(canonicalComponentPresentation(null, 'PROVEN').status, 'outage');
});

test('strategy header and Watchman remain validate-only for hostile machine-ready dry-run input', () => {
  const basis = component();
  const volume = component({ componentId: 'volume-engine', owner: 'VolumeEngine:server/src/engine/volume' });
  const strategy = canonicalStrategyRuntimePresentation(basis, volume, 'PROVEN');
  assert.deepEqual(strategy, { tone: 'warn', label: 'Validate-Only Ready', livePublicCount: 0 });

  const overall = canonicalWatchmanOverallPresentation({
    continuity: 'PROVEN',
    machineReady: 'YES',
    effectiveMode: 'VALIDATE_ONLY',
    components: [basis, volume],
  });
  assert.deepEqual(overall, { status: 'degraded', label: 'Validate Only' });

  const unknownMode = canonicalWatchmanOverallPresentation({
    continuity: 'PROVEN',
    machineReady: 'YES',
    effectiveMode: 'UNKNOWN',
    components: [
      component({ capability: 'LIVE_PUBLIC', truthLabel: 'LIVE_PUBLIC' }),
      component({ componentId: 'volume-engine', capability: 'LIVE_PUBLIC', truthLabel: 'LIVE_PUBLIC' }),
    ],
  });
  assert.deepEqual(unknownMode, { status: 'degraded', label: 'Effective Mode Unknown' });
});

test('System Health cannot paint machine-ready non-operational modes green', async () => {
  const liveComponents = [
    component({ capability: 'LIVE_PUBLIC', truthLabel: 'LIVE_PUBLIC' }),
    component({ componentId: 'volume-engine', capability: 'LIVE_PUBLIC', truthLabel: 'LIVE_PUBLIC' }),
  ];
  for (const [effectiveMode, label] of [
    ['VALIDATE_ONLY', 'Validate Only'],
    ['READ_ONLY', 'Read Only'],
    ['ADVISORY', 'Advisory'],
  ]) {
    assert.deepEqual(canonicalWatchmanOverallPresentation({
      continuity: 'PROVEN',
      machineReady: 'YES',
      effectiveMode,
      components: liveComponents,
    }), { status: 'degraded', label });
  }

  const source = await readFile(new URL('../../src/pages/SystemHealth.tsx', import.meta.url), 'utf8');
  assert.match(source, /canonicalWatchmanOverallPresentation\(\{[\s\S]*effectiveMode: snapshot\.ownerView\.effectiveMode,[\s\S]*components: snapshot\.components,/);
  assert.match(source, /overallPresentation\.status === 'operational'[\s\S]*\? 'healthy'/);
  assert.match(source, /\{overallPresentation\.label\}/);
  assert.doesNotMatch(source, /machineReady === 'YES'\s*\?\s*'healthy'/);
});

test('Trust Advisor derives its overall tone from canonical posture and cannot green hostile non-live modes', async () => {
  const liveComponents = [
    component({ capability: 'LIVE_PUBLIC', truthLabel: 'LIVE_PUBLIC' }),
    component({ componentId: 'volume-engine', capability: 'LIVE_PUBLIC', truthLabel: 'LIVE_PUBLIC' }),
  ];
  for (const [effectiveMode, label] of [
    ['VALIDATE_ONLY', 'Validate Only'],
    ['READ_ONLY', 'Read Only'],
    ['ADVISORY', 'Advisory'],
  ]) {
    const posture = canonicalWatchmanOverallPresentation({
      continuity: 'PROVEN',
      machineReady: 'YES',
      effectiveMode,
      components: liveComponents,
    });
    assert.deepEqual(posture, { status: 'degraded', label });
  }
  assert.deepEqual(canonicalWatchmanOverallPresentation({
    continuity: 'PROVEN',
    machineReady: 'YES',
    effectiveMode: 'READ_ONLY',
    components: [component(), liveComponents[1]],
  }), { status: 'degraded', label: 'Validate Only' });

  const source = await readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const advisorOverallPresentation');
  const end = source.indexOf('const advScore', start);
  assert.notEqual(start, -1, 'Header does not define canonical advisor posture');
  assert.notEqual(end, -1, 'Header advisor posture block is incomplete');
  const advisorSource = source.slice(start, end);
  assert.match(advisorSource, /canonicalWatchmanOverallPresentation\(\{[\s\S]*continuity: productBinding\.continuity,[\s\S]*machineReady: productSnapshot\.ownerView\.machineReady,[\s\S]*effectiveMode: productSnapshot\.ownerView\.effectiveMode,[\s\S]*components: productSnapshot\.components,/);
  assert.match(advisorSource, /advisorOverallPresentation\.status === 'outage'[\s\S]*\? 'bad'/);
  assert.match(advisorSource, /advisorOverallPresentation\.status !== 'operational'[\s\S]*\? 'warn'/);
  assert.doesNotMatch(advisorSource, /machineReady\s*===\s*['"]YES['"]/);
});

test('premium topbar keeps all six measured roles in empty, action, and preference states', async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/styles.css', import.meta.url), 'utf8'),
  ]);

  const headerComponent = source.slice(source.indexOf('function OpsSheetHeader'), source.indexOf('function PopupSourceMark'));
  assert.match(headerComponent, /className="ops-sheet-trailing"[\s\S]*className=\{`ops-sheet-status \$\{tone\}`\}[\s\S]*className="ops-sheet-action"/);

  const premiumStart = source.indexOf('const premiumContent');
  const notifications = source.slice(source.indexOf("case 'notif':", premiumStart), source.indexOf("case 'power':", premiumStart));
  assert.match(notifications, /<OpsRow[\s\S]*title="Inbox Clear"[\s\S]*detail="Only owner-relevant alerts appear here\.[\s\S]*value="Clear"/);
  assert.doesNotMatch(notifications, /ops-empty-state/);

  const basis = source.slice(source.indexOf("case 'basisu':", premiumStart), source.indexOf("case 'account':", premiumStart));
  for (const value of ['PCT', 'BPS', 'DEC']) {
    assert.match(basis, new RegExp(`<span className="ops-row-value">${value}<\\/span>`));
  }

  const appearanceStart = source.indexOf("case 'appearance':", premiumStart);
  const appearance = source.slice(appearanceStart, source.indexOf("\n    }\n  };", appearanceStart));
  assert.match(appearance, /className="ops-row ops-appearance-note"[\s\S]*className="ops-row-copy"[\s\S]*className="ops-row-value"/);

  assert.match(styles, /\.ops-sheet-trailing\s*\{[\s\S]*grid-template-rows:\s*14px 30px\s*!important;/);
  assert.match(styles, /\.ops-control-list[^\{]*\{[^}]*grid-template-rows:\s*repeat\(5,/);
});

test('Account Details uses the shared 84px identity-header hook', async () => {
  const [header, styles] = await Promise.all([
    readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/styles.css', import.meta.url), 'utf8'),
  ]);
  const accountSheet = header.slice(header.indexOf('function AccountSheet()'), header.indexOf('// ---- sidebar search'));
  assert.match(accountSheet, /<OpsSheetHeader\s+className="account-v3-head"/);
  assert.match(styles, /\.smenu-bar\.topbar-suite-v4 \.smenu-pane \.account-v3-head\s*\{[^}]*height:\s*84px\s*!important;[^}]*min-height:\s*84px\s*!important;[^}]*max-height:\s*84px\s*!important;/s);
});

test('kill-switch control stays idempotent engage-only and never offers Resume', async () => {
  assert.deepEqual(canonicalKillSwitchEngagePosture({
    currentEffectiveValue: 'ENGAGED',
    payload: { engaged: true },
  }), {
    engaged: true,
    actionAllowed: false,
    buttonLabel: 'Already Engaged',
    disabledReason: 'Kill switch is already ENGAGED. Release is unavailable in this candidate.',
  });
  assert.equal(canonicalKillSwitchEngagePosture({
    currentEffectiveValue: 'CLEAR',
    payload: { engaged: false },
  }).actionAllowed, false);
  assert.deepEqual(canonicalKillSwitchEngagePosture({
    currentEffectiveValue: 'CLEAR',
    payload: { engaged: true },
  }), {
    engaged: false,
    actionAllowed: true,
    buttonLabel: 'Preview STOP BOT',
    disabledReason: null,
  });

  const source = await readFile(new URL('../../src/features/productControlRoom/components/ControlRegistryPanel.tsx', import.meta.url), 'utf8');
  assert.match(source, /canonicalKillSwitchEngagePosture\(control\)/);
  assert.match(source, /emergencyPosture\?\.actionAllowed/);
  assert.doesNotMatch(source, /Preview Resume|>Resume</);
});

test('Notifications cannot derive engine green state from legacy runtime polls', async () => {
  const source = await readFile(new URL('../../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /useProductControlRoomContext\(\)/);
  assert.match(source, /canonicalStrategyRuntimePresentation\(/);
  assert.match(source, /canonicalComponentPresentation\(/);
  assert.match(source, /runtimePresentation\.livePublicCount/);
  assert.doesNotMatch(source, /\/api\/engine\/(?:basis|volume)/);
  assert.doesNotMatch(source, /status\?\.running|\/ 2 Online|are online/);
});

test('operational risk and governance policy is read-only outside canonical control preview', async () => {
  const [risk, rules] = await Promise.all([
    readFile(new URL('../../src/pages/Risk.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/Rules.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(risk, /CONTROL_PREVIEW_REQUIRED/);
  assert.match(risk, /OWNER_GATED/);
  assert.match(risk, /readOnly\s+disabled/);
  assert.doesNotMatch(risk, /saveConfig|patchList|saveDraft|Save Changes|Add Allowed Symbol|Add Blocked Symbol/);

  assert.match(rules, /CONTROL_PREVIEW_REQUIRED/);
  assert.match(rules, /OWNER_GATED/);
  assert.doesNotMatch(rules, /saveConfig|rule-form|rf-add|rule-del|Add rule|Delete rule/);
});

test('only exact public-information refresh targets can bypass canonical control preview', async () => {
  for (const target of ['all', 'market', 'runtime']) {
    assert.deepEqual(canonicalRefreshTargetPosture(target), {
      actionAllowed: false,
      statusLabel: 'CONTROL_PREVIEW_REQUIRED',
      actionLabel: 'Control Preview Required',
      reason: 'Managed-runtime recovery requires canonical Product control preview and a durable command receipt.',
    });
  }
  for (const target of ['news', 'calendar', 'fx']) {
    const posture = canonicalRefreshTargetPosture(target);
    assert.equal(posture.actionAllowed, true);
    assert.equal(posture.statusLabel, 'PUBLIC_REFRESH');
  }

  const [header, store] = await Promise.all([
    readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/store.tsx', import.meta.url), 'utf8'),
  ]);
  const refreshDock = header.slice(header.indexOf('export function RefreshDock()'), header.indexOf('export function Topbar()'));
  assert.match(refreshDock, /if \(!targetPosture\.actionAllowed\)[\s\S]*return;[\s\S]*fetch\('\/api\/refresh'/);
  assert.match(refreshDock, /disabled=\{busy\.current \|\| !selectedRecovery\.posture\.actionAllowed\}/);
  assert.match(refreshDock, /CONTROL_PREVIEW_REQUIRED/);
  assert.doesNotMatch(store, /(?:post|fetch)(?:<[^>]+>)?\('\/api\/refresh'/);
});
