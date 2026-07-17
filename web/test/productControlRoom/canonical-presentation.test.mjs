import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canonicalKillSwitchEngagePosture,
  canonicalRefreshTargetPosture,
  canonicalWatchmanLauncherPresentation,
} from '../../src/lib/operatorControlPosture.ts';

test('canonical cockpit presentation is owned by the server projection and the client derivation module is retired', async () => {
  const serverProjection = await readFile(new URL('../../../server/src/productIntegration/runtime/projection.ts', import.meta.url), 'utf8');
  assert.match(serverProjection, /function canonicalComponentPresentation\(/);
  assert.match(serverProjection, /function canonicalCockpitTruth\(/);
  assert.match(serverProjection, /canonicalCockpit,[\s\S]*digest:/);
  await assert.rejects(
    readFile(new URL('../../src/lib/canonicalCockpitTruth.ts', import.meta.url), 'utf8'),
    (error) => error?.code === 'ENOENT',
  );
});

test('all cockpit consumers render canonical supervisor presentation without client-side recomputation', async () => {
  const consumers = await Promise.all([
    readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/Dashboard.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/SystemHealth.tsx', import.meta.url), 'utf8'),
  ]);
  const combined = consumers.join('\n');
  assert.match(consumers[0], /productSnapshot\.canonicalCockpit\.watchmanOverall/);
  assert.match(consumers[0], /productSnapshot\.canonicalCockpit\.marketFeedReadiness/);
  assert.match(consumers[0], /component\.canonicalPresentation/);
  assert.match(consumers[1], /productSnapshot\.canonicalCockpit\.strategyRuntime/);
  assert.match(consumers[2], /productSnapshot\.canonicalCockpit\.strategyRuntime/);
  assert.match(consumers[3], /snapshot\.canonicalCockpit\.watchmanOverall/);
  assert.doesNotMatch(combined, /canonical(?:Component|MarketFeedReadiness|StrategyRuntime|WatchmanOverall)Presentation\s*\(/);
});

test('surface renderer and CSS require relational readiness before showing live-public green', async () => {
  const [renderer, styles] = await Promise.all([
    readFile(new URL('../../src/features/productControlRoom/components/SurfaceBindingPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/features/productControlRoom/styles/productControlRoom.css', import.meta.url), 'utf8'),
  ]);
  assert.match(renderer, /productSurfaceReadinessBlocker\(surface\)/);
  assert.match(renderer, /data-surface-ready=\{effectiveBlocked \? 'false' : 'true'\}/);
  assert.match(renderer, /effectiveBlocked \? 'BLOCKED' : surface\.truthLabel/);
  assert.match(styles, /\.pcr-surface-end em\.truth-live-public\s*\{\s*color:\s*var\(--text-2\);\s*\}/);
  assert.match(styles, /\.pcr-surface\[data-surface-ready="true"\] \.pcr-surface-end em\.truth-live-public\s*\{\s*color:\s*var\(--up\);\s*\}/);
});

test('System Health maps only the canonical supervisor Watchman status to its visual tone', async () => {
  const source = await readFile(new URL('../../src/pages/SystemHealth.tsx', import.meta.url), 'utf8');
  assert.match(source, /snapshot\.canonicalCockpit\.watchmanOverall/);
  assert.match(source, /overallPresentation\.status === 'operational'[\s\S]*\? 'healthy'/);
  assert.match(source, /\{overallPresentation\.label\}/);
  assert.doesNotMatch(source, /machineReady === 'YES'\s*\?\s*'healthy'/);
});

test('Trust Advisor uses canonical supervisor posture and feed readiness', async () => {
  const source = await readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('const advisorOverallPresentation');
  const end = source.indexOf('const advScore', start);
  assert.notEqual(start, -1, 'Header does not define canonical advisor posture');
  assert.notEqual(end, -1, 'Header advisor posture block is incomplete');
  const advisorSource = source.slice(start, end);
  assert.match(advisorSource, /productSnapshot\.canonicalCockpit\.watchmanOverall/);
  assert.match(advisorSource, /productSnapshot\.canonicalCockpit\.marketFeedReadiness/);
  assert.match(advisorSource, /advisorOverallPresentation\.status === 'operational'/);
  assert.match(advisorSource, /advisorMarketFeedReadiness\.proven/);
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
  assert.match(source, /productSnapshot\.canonicalCockpit\.strategyRuntime/);
  assert.match(source, /runtimePresentation\.livePublicCount/);
  assert.doesNotMatch(source, /canonical(?:Component|StrategyRuntime)Presentation\s*\(/);
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
  assert.match(refreshDock, /if \(!targetPosture\.actionAllowed\)[\s\S]*return;[\s\S]*fetchJson<\{[\s\S]*\}>\('\/api\/refresh'/);
  assert.match(refreshDock, /disabled=\{busy\.current \|\| !selectedRecovery\.posture\.actionAllowed\}/);
  assert.match(refreshDock, /CONTROL_PREVIEW_REQUIRED/);
  assert.doesNotMatch(store, /(?:post|fetch)(?:<[^>]+>)?\('\/api\/refresh'/);
});

test('successful local refresh cannot supersede canonical Watchman outage truth', async () => {
  assert.deepEqual(canonicalWatchmanLauncherPresentation({
    canonicalStatus: 'outage',
    canonicalLabel: 'Not Ready',
    actionState: 'ok',
  }), {
    healthStatus: 'outage',
    label: 'Connection Watchman · Not Ready · Public Refresh Completed',
  });

  const [header, styles] = await Promise.all([
    readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/styles.css', import.meta.url), 'utf8'),
  ]);
  const refreshDock = header.slice(header.indexOf('export function RefreshDock()'), header.indexOf('export function Topbar()'));
  assert.match(refreshDock, /canonicalWatchmanLauncherPresentation\(\{/);
  assert.match(refreshDock, /data-action-state=\{st\}/);
  assert.match(refreshDock, /rdock-control-state status-\$\{launcherPresentation\.healthStatus\}/);
  assert.doesNotMatch(refreshDock, /Connections Recovered/);
  assert.doesNotMatch(refreshDock, /st === 'ok' \? 'operational'/);
  assert.doesNotMatch(styles, /\.rdock-(?:control-)?btn\.(?:ok|err)\b/);
});
