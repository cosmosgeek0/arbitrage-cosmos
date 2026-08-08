import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { projectCanonicalIncidentNotifications } from '../../src/lib/productIntegration/incidentNotifications.ts';

const pageUrl = new URL('../../src/pages/NotificationsPage.tsx', import.meta.url);
const stylesUrl = new URL('../../src/pages/NotificationsPage.css', import.meta.url);

const canonicalIncident = {
  incidentId: 'incident.product.engine-supervisor.episode.42',
  fingerprint: 'fingerprint:engine-supervisor',
  ledgerEventId: 42,
  severity: 'HIGH',
  rootComponentId: 'engine-supervisor',
  sourceGroup: 'bot',
  capitalRelevant: false,
  firstSeenAtMs: 1_800_000_000_000,
  lastSeenAtMs: 1_800_000_001_000,
  count: 3,
  state: 'OPEN',
  reasonCode: 'CONNECTION_UNHEALTHY',
  operatorAction: 'Inspect canonical incident evidence.',
  correlationId: 'correlation:engine-supervisor',
  acknowledgedAtMs: null,
  acknowledgedByOperatorId: null,
  resolvedAtMs: null,
  acknowledgementControlId: 'control:incident-42',
  routing: {
    inApp: { state: 'WIRED_LOCAL', receiptId: 'ledger-event:42' },
    externalPaging: {
      state: 'NOT_CONFIGURED',
      receiptId: null,
      blocker: 'EXTERNAL_PAGING_OWNER_NOT_CONFIGURED',
    },
  },
  recoveryProof: { state: 'PENDING', sourceEventId: null, resolvedAtMs: null },
};

test('Epoch 5R Notifications projects only available canonical Product incident episodes', () => {
  const unavailable = projectCanonicalIncidentNotifications(
    { state: 'UNAVAILABLE', truthLabel: 'UNAVAILABLE', blocker: 'SUPERVISOR_UNAVAILABLE' },
    [canonicalIncident],
  );
  assert.deepEqual(unavailable, []);

  const available = projectCanonicalIncidentNotifications(
    { state: 'AVAILABLE', truthLabel: 'BUILT_AND_TESTED', blocker: null },
    [canonicalIncident],
  );
  assert.equal(available.length, 1);
  assert.equal(available[0].id, canonicalIncident.ledgerEventId);
  assert.equal(available[0].count, canonicalIncident.count);
  assert.equal(available[0].kind, 'product_incident');
});

test('Epoch 5R Notifications fails closed without inventing zero incidents or routing state', async () => {
  const [page, styles] = await Promise.all([
    readFile(pageUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(page, /projectCanonicalIncidentNotifications\(\s*incidentAvailability,\s*canonicalIncidents/);
  assert.doesNotMatch(page, /useNotificationFeed|notificationFeedState|\/api\/events/);

  assert.match(page, /function truthfulIncidentCount\(available: boolean, value: number\): number \| '—'/);
  assert.match(page, /truthfulIncidentCount\(incidentTruthAvailable, notifications\.length\)/);
  assert.match(page, /truthfulIncidentCount\(incidentTruthAvailable, groupedCount\)/);
  assert.match(page, /Read State Unavailable/);
  assert.match(page, /disabled=\{!incidentTruthAvailable \|\| unread === 0\}/);

  assert.match(page, /fetchJson<unknown>\('\/api\/notification-routing'/);
  assert.match(page, /type RoutingReadbackState = 'PENDING' \| 'CURRENT' \| 'UNAVAILABLE'/);
  assert.match(page, /\{localRoutingReadbackCurrent \? <>[\s\S]*notifx-routing-grid[\s\S]*notifx-routing-unavailable/);

  assert.match(page, /This Browser Only/);
  assert.match(page, /They do not change Product routing, delivery, acknowledgement, or Ledger state/);
  assert.match(page, /const latestAction = notifications\.find\(\(item\) => item\.needsAction\)/);
  assert.doesNotMatch(page, /const latestAction = enabled\.find/);
  assert.doesNotMatch(page, /Choose What Interrupts You|Save Preferences|Logs Stay Complete/);

  assert.match(page, /IncidentAcknowledgementButton/);
  assert.match(page, /localStorage\.setItem\('cosmos-notif-seen'/);
  assert.match(page, /Mark \$\{unread\} Read Here/);

  assert.match(styles, /\.notifx-policy-badge\.unavailable/);
  assert.match(styles, /\.notifx-routing-unavailable/);
  assert.match(styles, /\.notifx-local-rules/);
});

test('Epoch 5R Notifications distinguishes supervisor catalog binding from local non-authoritative capability truth', async () => {
  const [page, styles] = await Promise.all([
    readFile(pageUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ]);

  assert.match(page, /aria-label="Supervisor Catalog and Build Binding"/);
  assert.match(page, /Supervisor Catalog \/ Build Binding/);
  assert.match(page, /Not Live Delivery Or Direct Routing Readback/);
  assert.match(page, /required adapter can show catalog\/build states such as IN_APP WIRED_LOCAL/);
  assert.match(page, /<ProductSurfaceAdapter surfaceId="notifications" \/>/);

  assert.match(page, /aria-label="Local Non-Authoritative Notification Capability Readback"/);
  assert.match(page, /Local Capability Truth/);
  assert.match(page, /Non-Authoritative Routing Capability/);
  assert.match(page, /It is not live delivery evidence or server routing authority/);
  assert.match(page, /Not a live delivery receipt/);

  assert.doesNotMatch(page, /Canonical Readback|canonical notification routing endpoint|Routing Readback Current|Product Incident Delivery|Where Episodes Are Delivered/);
  assert.match(styles, /\.notifx-supervisor-binding-label/);
});

test('Epoch 5R Notifications keeps direct readback fail-closed and subordinate to no catalog evidence', async () => {
  const page = await readFile(pageUrl, 'utf8');
  const adapterBand = page.indexOf('aria-label="Supervisor Catalog and Build Binding"');
  const localReadbackBand = page.indexOf('aria-label="Local Non-Authoritative Notification Capability Readback"');
  assert.ok(adapterBand >= 0 && localReadbackBand > adapterBand, 'catalog and direct-readback bands must be separate and ordered');

  const precedenceStart = page.indexOf('const localRoutingReadbackCurrent =');
  const precedenceEnd = page.indexOf('const notifications =', precedenceStart);
  const precedence = page.slice(precedenceStart, precedenceEnd);
  assert.match(precedence, /const directInAppCapabilityEligible = canonicalInAppAvailable && localRoutingReadbackCurrent/);
  assert.match(precedence, /failClosedRouting\(\s*routingReadback,\s*directInAppCapabilityEligible/);
  assert.doesNotMatch(precedence, /ProductSurfaceAdapter|productSnapshot\.surfaces|bindingState/);

  const directBand = page.slice(localReadbackBand, page.indexOf('aria-label="This Browser Inbox Filters"', localReadbackBand));
  assert.match(directBand, /\{localRoutingReadbackCurrent \? <>/);
  assert.match(directBand, /Direct capability and policy rows stay withheld until this local readback validates/);
  assert.match(directBand, /supervisor catalog\/build band above is separate and may still show its binding state/);
  assert.doesNotMatch(directBand, /No connector or policy state is presented/);
  assert.doesNotMatch(directBand, /botState|runtimePresentation|productSnapshot\.surfaces|bindingState/);
});
