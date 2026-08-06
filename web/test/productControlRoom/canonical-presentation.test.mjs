import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canonicalKillSwitchEngagePosture,
  canonicalRefreshTargetPosture,
  canonicalWatchmanLauncherPresentation,
} from '../../src/lib/operatorControlPosture.ts';
import {
  createFixtureSession,
  validateProductSupervisorEnvelope,
} from '../../src/lib/productIntegration/model.ts';
import { buildProductControlRoomFixture } from '../../src/features/productControlRoom/fixtureBinding.ts';

const PUBLIC_FEED_NOW = 1_800_000_000_000;

function publicFeedEnvelope() {
  const envelope = structuredClone(buildProductControlRoomFixture(
    createFixtureSession('HEALTHY_OBSERVE', 'public-feed-readiness', PUBLIC_FEED_NOW),
  ));
  envelope.ownerView.machineReady = 'NO';
  envelope.ownerView.dataFreshness = '900ms max public-source age';
  envelope.dashboard.summaries.capital.accountTruthState = 'NOT_CONFIGURED';
  envelope.canonicalCockpit.marketFeedReadiness = {
    proven: true,
    label: 'Market Feed Readiness Proven',
    detail: 'Canonical Spot and USD-M sources are READY · LIVE PUBLIC · LIVE PUBLIC; owner freshness 900ms max public-source age.',
  };
  for (const componentId of ['public-spot-source', 'public-usdm-source']) {
    const source = envelope.components.find((component) => component.componentId === componentId);
    assert.ok(source);
    source.canonicalPresentation = {
      status: 'operational',
      tone: 'ok',
      statusLabel: 'Live Public',
      stateLabel: 'READY · LIVE PUBLIC · LIVE PUBLIC',
    };
  }
  return envelope;
}

function canonicalMarketFeedRejected(envelope) {
  return validateProductSupervisorEnvelope(envelope).includes('CANONICAL_MARKET_FEED_FALSE_GREEN');
}

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

test('canonical public feed readiness is independent of global machine and private-account readiness', () => {
  const validPublicState = publicFeedEnvelope();
  assert.equal(validPublicState.ownerView.machineReady, 'NO');
  assert.equal(validPublicState.dashboard.summaries.capital.accountTruthState, 'NOT_CONFIGURED');
  assert.equal(canonicalMarketFeedRejected(validPublicState), false);

  const nullFreshness = publicFeedEnvelope();
  nullFreshness.ownerView.dataFreshness = null;
  assert.equal(canonicalMarketFeedRejected(nullFreshness), true);

  const invalidFreshness = publicFeedEnvelope();
  invalidFreshness.ownerView.dataFreshness = '';
  assert.equal(canonicalMarketFeedRejected(invalidFreshness), true);

  const staleSource = publicFeedEnvelope();
  const staleSpot = staleSource.components.find((component) => component.componentId === 'public-spot-source');
  staleSpot.freshnessState = 'STALE';
  staleSpot.canonicalPresentation = {
    status: 'degraded', tone: 'warn', statusLabel: 'Stale', stateLabel: 'READY · LIVE PUBLIC · STALE',
  };
  assert.equal(canonicalMarketFeedRejected(staleSource), true);

  const missingSource = publicFeedEnvelope();
  missingSource.components = missingSource.components.filter(
    (component) => component.componentId !== 'public-usdm-source',
  );
  assert.equal(canonicalMarketFeedRejected(missingSource), true);

  const duplicateSource = publicFeedEnvelope();
  duplicateSource.components.push(structuredClone(
    duplicateSource.components.find((component) => component.componentId === 'public-spot-source'),
  ));
  assert.equal(canonicalMarketFeedRejected(duplicateSource), true);

  const nonOperationalSource = publicFeedEnvelope();
  nonOperationalSource.components.find(
    (component) => component.componentId === 'public-usdm-source',
  ).canonicalPresentation = {
    status: 'outage', tone: 'bad', statusLabel: 'Unavailable', stateLabel: 'FAILED · LIVE PUBLIC · UNAVAILABLE',
  };
  assert.equal(canonicalMarketFeedRejected(nonOperationalSource), true);
});

test('all cockpit consumers render canonical supervisor presentation without client-side recomputation', async () => {
  const consumers = await Promise.all([
    readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/Dashboard.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/SystemHealth.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/Watchdog.tsx', import.meta.url), 'utf8'),
  ]);
  const combined = consumers.join('\n');
  assert.match(consumers[0], /productSnapshot\.canonicalCockpit\.watchmanOverall/);
  assert.match(consumers[0], /productSnapshot\.canonicalCockpit\.marketFeedReadiness/);
  assert.match(consumers[1], /productSnapshot\.canonicalCockpit\.strategyRuntime/);
  assert.match(consumers[2], /productSnapshot\.canonicalCockpit\.strategyRuntime/);
  assert.match(consumers[3], /snapshot\.canonicalCockpit\.watchmanOverall/);
  // The retired floating launcher owned the component-presentation render;
  // Watchdog is now the surface that consumes it.
  assert.match(consumers[4], /component\.canonicalPresentation/);
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

test('no rule may force-paint a bad advisor grade a healthy green', async () => {
  const [styles, header] = await Promise.all([
    readFile(new URL('../../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8'),
  ]);
  const GREEN = String.raw`#16a34a|#22c55e|#24c85a|#45bb30|#77d83e|#349a38|var\(--up\)|var\(--ops-green\)`;

  // (1) targeted: no rule may enumerate a bad advisor grade and resolve green.
  assert.doesNotMatch(
    styles,
    new RegExp(String.raw`\.advisor-premium-trigger\.grade-bad[^{}]*\{[^}]*color:[^;}]*(?:${GREEN})`),
  );

  // (2) systemic: the topbar spectrum block is decoration and may never
  // enumerate an advisor grade class again — naming a state class there
  // outranks the semantic grade rules on specificity as well as order.
  // (The remaining state classes flattened by this block belong to the
  // Execution Control owner ruling and are the director's call.)
  const start = styles.indexOf('/* ==== TOPBAR SPECTRUM ORDER');
  assert.notEqual(start, -1, 'topbar spectrum block was renamed; update this guard');
  const block = styles.slice(start, styles.indexOf('.smenu-bar button.hdr-ic.notif-premium-trigger', start));
  assert.doesNotMatch(block, /\.advisor-premium-trigger\.grade-(?:ok|warn|bad)\b/);

  // (3) the semantic grade rule must remain the winning authority for
  // grade-bad, resolving to a red tone.
  const last = styles.lastIndexOf('.advisor-premium-trigger.grade-bad');
  assert.notEqual(last, -1);
  assert.match(styles.slice(last, styles.indexOf('}', last)), /var\(--ops-red\)|var\(--down\)/);

  // (4) the glyph is 85% green pixels, so colour alone cannot carry state:
  // the non-ok grades must render the real-state pip beside the shield.
  assert.match(header, /advTone !== 'ok' && <i className="rail-state-pip" data-grade=\{advTone\}/);
  assert.match(styles, /\.trust-advisor-trigger-core \.rail-state-pip\[data-grade="bad"\]\s*\{\s*background:\s*var\(--ops-red\);\s*\}/);
  assert.match(styles, /\.trust-advisor-trigger-core \.rail-state-pip\[data-grade="warn"\]\s*\{\s*background:\s*var\(--ops-amber\);\s*\}/);

  // (5) the v4 rail paints every rail button `color: var(--rail-tone)` at
  // HIGHER specificity than the semantic grade rules — measured live by the
  // ship-gate reload: a grade-bad advisor rendered the decorative green rail
  // tone in all three grades. The tone variable itself must therefore carry
  // the true grade under v4, with the same hue authorities as the pip.
  assert.match(
    styles,
    /\.topbar-suite-v4 > button\[data-topbar-key="advisor"\]\.grade-warn \{ --rail-tone: var\(--ops-amber\); \}/,
  );
  assert.match(
    styles,
    /\.topbar-suite-v4 > button\[data-topbar-key="advisor"\]\.grade-bad \{ --rail-tone: var\(--ops-red\); \}/,
  );
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
  assert.match(notifications, /<OpsRow[\s\S]*title="No Durable Incident Episodes"[\s\S]*not a derived system all-clear[\s\S]*value="Owner Available"[\s\S]*tone="idle"/);
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

  const [header, store, watchdog] = await Promise.all([
    readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/store.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/Watchdog.tsx', import.meta.url), 'utf8'),
  ]);
  // The floating Watchman launcher is retired and the Watchdog observatory is
  // now the browser's only direct-refresh owner. It keeps the same posture gate
  // ahead of the same POST, and refuses with the canonical status label.
  assert.match(watchdog, /if \(!posture\.actionAllowed\)[\s\S]*return;[\s\S]*fetchJson<\{[\s\S]*\}>\('\/api\/refresh'/);
  assert.match(watchdog, /disabled=\{refreshSt === 'spin' \|\| !refreshPosture\.actionAllowed\}/);
  assert.match(watchdog, /\$\{posture\.statusLabel\} · \$\{posture\.reason\}/);
  assert.doesNotMatch(header, /(?:post|fetch)(?:<[^>]+>)?\('\/api\/refresh'/);
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
  // The launcher is retired: the shell no longer mounts a local action state
  // that could ever be mistaken for canonical Watchman truth.
  assert.doesNotMatch(header, /rdock-control-btn/);
  assert.doesNotMatch(header, /data-action-state=\{st\}/);
  assert.doesNotMatch(header, /Connections Recovered/);
  assert.doesNotMatch(header, /st === 'ok' \? 'operational'/);
  assert.doesNotMatch(styles, /\.rdock-(?:control-)?btn\.(?:ok|err)\b/);
});
