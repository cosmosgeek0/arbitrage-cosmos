import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { productIncidentAcknowledgementControlId } from '../../../server/src/productIntegration/runtime/controls.ts';
import { projectCanonicalIncidentNotifications } from '../../src/lib/productIntegration/incidentNotifications.ts';
import {
  decodeNotificationRoutingSnapshot,
} from '../../src/lib/productIntegration/notificationRouting.ts';
import {
  browserIncidentAcknowledgementControlId,
  sha256Utf8,
} from '../../src/lib/productIntegration/sha256.ts';

const NOW = 1_800_000_000_000;

function routingSnapshot() {
  const connector = (label, overrides = {}) => ({
    available: false,
    state: 'NOT_CONFIGURED',
    label,
    detail: `${label} detail`,
    ...overrides,
  });
  return {
    sources: {
      bot: { available: true, label: 'Bot Runtime', detail: 'Canonical runtime transitions' },
      execution: { available: false, label: 'Execution', detail: 'Not configured' },
      aws: {
        available: false,
        label: 'AWS',
        detail: 'Owner gated',
        endpoint: '/api/notifications/ingest/aws',
      },
    },
    destinations: {
      inApp: connector('In-App', { available: true, state: 'WIRED_LOCAL' }),
      email: connector('Email'),
      telegram: connector('Telegram'),
      whatsapp: connector('WhatsApp'),
      awsSns: connector('AWS SNS'),
    },
    policy: { transitionsOnly: true, repeatWindowMinutes: 15, rawLogsExcluded: true },
  };
}

function incident(overrides = {}) {
  const incidentId = overrides.incidentId ?? 'incident.product.default';
  const state = overrides.state ?? 'OPEN';
  const lastSeenAtMs = overrides.lastSeenAtMs ?? NOW;
  return {
    incidentId,
    fingerprint: `fingerprint:${incidentId}`,
    ledgerEventId: overrides.ledgerEventId ?? 1,
    severity: overrides.severity ?? 'MEDIUM',
    rootComponentId: overrides.rootComponentId ?? 'engine-supervisor',
    sourceGroup: overrides.sourceGroup ?? 'bot',
    capitalRelevant: overrides.capitalRelevant ?? false,
    firstSeenAtMs: overrides.firstSeenAtMs ?? lastSeenAtMs - 1_000,
    lastSeenAtMs,
    count: overrides.count ?? 1,
    state,
    reasonCode: 'CONNECTION_UNHEALTHY',
    operatorAction: 'Inspect canonical incident evidence.',
    correlationId: `correlation:${incidentId}`,
    acknowledgedAtMs: state === 'ACKNOWLEDGED' ? lastSeenAtMs : null,
    acknowledgedByOperatorId: state === 'ACKNOWLEDGED' ? 'operator-1' : null,
    resolvedAtMs: state === 'RESOLVED' ? lastSeenAtMs : null,
    acknowledgementControlId: browserIncidentAcknowledgementControlId(incidentId),
    routing: {
      inApp: { state: 'WIRED_LOCAL', receiptId: `ledger-event:${overrides.ledgerEventId ?? 1}` },
      externalPaging: {
        state: 'NOT_CONFIGURED',
        receiptId: null,
        blocker: 'EXTERNAL_PAGING_OWNER_NOT_CONFIGURED',
      },
    },
    recoveryProof: state === 'RESOLVED'
      ? { state: 'PROVEN', sourceEventId: (overrides.ledgerEventId ?? 1) - 1, resolvedAtMs: lastSeenAtMs }
      : { state: 'PENDING', sourceEventId: null, resolvedAtMs: null },
  };
}

test('browser SHA-256 matches known vectors and the canonical server incident control derivation', () => {
  const vectors = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['Arbitrage Cosmos 🌌', createHash('sha256').update('Arbitrage Cosmos 🌌', 'utf8').digest('hex')],
  ];
  for (const [input, expected] of vectors) assert.equal(sha256Utf8(input), expected);

  for (const incidentId of [
    'incident.product.market-streams.episode.41',
    'incident.product.engine-supervisor.episode.200',
    'incident.product.UTF8-δ.episode.1',
  ]) {
    assert.equal(
      browserIncidentAcknowledgementControlId(incidentId),
      productIncidentAcknowledgementControlId(incidentId),
    );
  }
});

test('notification routing decoder accepts only the exact fail-closed capability relationship', () => {
  const valid = routingSnapshot();
  const decoded = decodeNotificationRoutingSnapshot(valid);
  assert.ok(decoded);
  assert.equal(decoded.destinations.inApp.state, 'WIRED_LOCAL');
  for (const key of ['email', 'telegram', 'whatsapp', 'awsSns']) {
    assert.equal(decoded.destinations[key].state, 'NOT_CONFIGURED');
    assert.equal(decoded.destinations[key].available, false);
  }
  assert.equal(Object.isFrozen(decoded), true);
  assert.equal(Object.isFrozen(decoded.destinations.inApp), true);

  const hostile = [
    null,
    [],
    { ...valid, extra: true },
    { ...valid, sources: { ...valid.sources, bot: { ...valid.sources.bot, extra: true } } },
    { ...valid, sources: { ...valid.sources, execution: { ...valid.sources.execution, available: true } } },
    { ...valid, sources: { ...valid.sources, aws: { ...valid.sources.aws, endpoint: '/api/notifications/ingest/aws/forged' } } },
    { ...valid, destinations: { ...valid.destinations, inApp: { ...valid.destinations.inApp, available: false } } },
    { ...valid, destinations: { ...valid.destinations, email: { ...valid.destinations.email, available: true, state: 'WIRED_LOCAL' } } },
    { ...valid, destinations: { ...valid.destinations, telegram: { ...valid.destinations.telegram, state: 'UNAVAILABLE' } } },
    { ...valid, policy: { ...valid.policy, repeatWindowMinutes: 14 } },
    { ...valid, destinations: { ...valid.destinations, whatsapp: null } },
  ];
  for (const candidate of hostile) {
    assert.doesNotThrow(() => decodeNotificationRoutingSnapshot(candidate));
    assert.equal(decodeNotificationRoutingSnapshot(candidate), null);
  }
});

test('canonical incident presentation retains old active episodes and preserves state then severity order', async () => {
  const oldOpen = incident({
    incidentId: 'incident.product.old-open',
    ledgerEventId: 11,
    severity: 'LOW',
    firstSeenAtMs: NOW - 45 * 86_400_000,
    lastSeenAtMs: NOW - 30 * 86_400_000,
  });
  const input = [
    incident({ incidentId: 'incident.product.resolved', ledgerEventId: 44, state: 'RESOLVED', severity: 'CRITICAL' }),
    oldOpen,
    incident({ incidentId: 'incident.product.ack', ledgerEventId: 33, state: 'ACKNOWLEDGED', severity: 'CRITICAL' }),
    incident({ incidentId: 'incident.product.open-critical', ledgerEventId: 22, severity: 'CRITICAL' }),
  ];
  const projected = projectCanonicalIncidentNotifications(
    { state: 'AVAILABLE', truthLabel: 'BUILT_AND_TESTED', blocker: null },
    input,
  );
  assert.deepEqual(projected.map((item) => item.id), [22, 11, 33, 44]);
  assert.equal(projected.find((item) => item.id === 11)?.needsAction, true);

  const [page, styles] = await Promise.all([
    readFile(new URL('../../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/NotificationsPage.css', import.meta.url), 'utf8'),
  ]);
  const selectionStart = page.indexOf('const activeItems =');
  const selectionEnd = page.indexOf('const categoryCounts =', selectionStart);
  const selection = page.slice(selectionStart, selectionEnd);
  const activeDeclaration = selection.slice(0, selection.indexOf(';') + 1);
  assert.match(selection, /enabled\.filter\(\(item\) => item\.needsAction\)/);
  assert.match(selection, /selectedDay === 'active' \? activeItems/);
  assert.doesNotMatch(activeDeclaration, /addDays|dayKey|Date\.now|seven|7\s*\*|\.sort\(/i);
  assert.match(page, /Active Attention — No Age Cutoff/);
  assert.match(styles, /\.notifx-week\s*\{[^}]*grid-template-columns:\s*repeat\(8,\s*minmax\(0,\s*1fr\)\)/s);
  assert.doesNotMatch(styles, /\.notifx-week\s*\{[^}]*minmax\(124px,/s);
});

test('incident ACK surface restores, reconciles, aborts stale work, and keeps ambiguous identity blocked', async () => {
  const source = await readFile(
    new URL('../../src/features/productControlRoom/components/IncidentAcknowledgementButton.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /queueMicrotask\([\s\S]*readDurableCommandResultIdentity\(\)[\s\S]*restored\.state === 'PENDING'[\s\S]*reconcileCommandResult\(restored\.identity, null\)/);
  assert.match(source, /window\.addEventListener\('storage', handleStorage\)/);
  assert.match(source, /window\.removeEventListener\('storage', handleStorage\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /reconciliationAbortRef\.current\?\.abort\(\)/);
  assert.match(source, /reconciliationRequestRef\.current !== requestId/);
  assert.match(source, /return \(\) => \{[\s\S]*cancelCommandResultRead\(\)/);
  assert.match(source, />Recheck Durable Result<\/button>/);
  assert.match(source, /value\.state === 'PENDING'[\s\S]*value\.state === 'AMBIGUOUS'[\s\S]*value\.state === 'INVALID_DURABLE_STATE'/);

  assert.match(source, /preview !== null\) confirmRef\.current\?\.focus\(\)/);
  assert.match(source, /requestAnimationFrame\(\(\) => initiatorRef\.current\?\.focus\(\)\)/);
  assert.match(source, /preview === null \? \([\s\S]*<button[\s\S]*ref=\{initiatorRef\}[\s\S]*Acknowledge incident/);
  assert.match(source, /<button ref=\{confirmRef\}[\s\S]*Confirm ACK/);
  assert.match(source, /onClick=\{cancel\}>Cancel<\/button>/);

  const submitCatchStart = source.indexOf('    } catch (cause) {', source.indexOf('  const submit = async'));
  const submitFinally = source.indexOf('    } finally {', submitCatchStart);
  const submitCatch = source.slice(submitCatchStart, submitFinally);
  assert.match(submitCatch, /readDurableCommandResultIdentity\(\)/);
  assert.match(submitCatch, /durable\.state === 'PENDING'[\s\S]*ambiguousCommandResultReconciliation/);
  assert.doesNotMatch(submitCatch, /clearDurableCommandResultIdentity/);
  const stateBranch = source.slice(source.indexOf("  if (incident.state !== 'OPEN')"), source.indexOf('  return (', source.indexOf("  if (incident.state !== 'OPEN')")));
  assert.match(stateBranch, /\{durableRecheck\}/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});

test('Execution notification controls remain disabled and the Header exposes no Execution tab', async () => {
  const [page, header] = await Promise.all([
    readFile(new URL('../../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(page, /key: 'execution', label: 'Execution NOT_CONFIGURED'[\s\S]*configured: false/);
  assert.match(page, /id: 'execution', label: 'Execution NOT_CONFIGURED'[\s\S]*configured: false/);
  assert.match(page, /FILTERS\.map\([\s\S]*disabled=\{option\.configured === false\}[\s\S]*aria-disabled=\{option\.configured === false\}/);
  assert.match(page, /RULES\.map\([\s\S]*disabled=\{rule\.configured === false\}[\s\S]*NOT_CONFIGURED/);

  const alertsMenu = header.slice(header.indexOf('function AlertsMenu()'), header.indexOf('// ---- data health'));
  assert.match(alertsMenu, /key: 'execution', label: 'Execution NOT_CONFIGURED'[\s\S]*configured: false/);
  assert.match(alertsMenu, /filter\(\(\[key, value\]\) => key !== 'execution' && value\)/);
  assert.match(alertsMenu, /disabled=\{r\.configured === false\}/);

  const premiumRowsStart = header.indexOf('const alertRows:');
  const premiumTabsStart = header.indexOf('const notifTabs:', premiumRowsStart);
  const premiumRows = header.slice(premiumRowsStart, premiumTabsStart);
  const premiumTabsEnd = header.indexOf('const notifToneFor', premiumTabsStart);
  const premiumTabs = header.slice(premiumTabsStart, premiumTabsEnd);
  assert.match(premiumRows, /key: 'execution', label: 'Execution NOT_CONFIGURED'[\s\S]*configured: false/);
  assert.doesNotMatch(premiumTabs, /id: 'execution'|label: 'Execution'/);
  assert.match(header, /alertsOn = Object\.entries\(al\)\.filter\(\(\[key, value\]\) => key !== 'execution' && value\)\.length/);
});
