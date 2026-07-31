import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const headerUrl = new URL('../../src/components/Header.tsx', import.meta.url);

test('I00-050 premium Header and Notifications page share canonical incident truth without local regrouping', async () => {
  const [source, page, selector] = await Promise.all([
    readFile(headerUrl, 'utf8'),
    readFile(new URL('../../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/lib/productIntegration/incidentNotifications.ts', import.meta.url), 'utf8'),
  ]);
  const sharedTopbarStart = source.indexOf('function SharedTopBar()');
  const notificationBoundaryEnd = source.indexOf('// Compute the box geometry', sharedTopbarStart);
  const premiumStart = source.indexOf('const premiumContent', sharedTopbarStart);
  const premiumNotificationStart = source.indexOf("case 'notif':", premiumStart);
  const premiumNotificationEnd = source.indexOf("case 'power':", premiumNotificationStart);
  const canonicalProjectionStart = source.indexOf('const incidentAvailability =', sharedTopbarStart);
  const canonicalProjectionEnd = source.indexOf('const killSwitchControl =', canonicalProjectionStart);
  const notificationTriggerTruthStart = source.indexOf('const notificationTriggerTruth =', sharedTopbarStart);
  const notificationTriggerTruthEnd = source.indexOf('const notificationFeedDetail =', notificationTriggerTruthStart);

  assert.notEqual(notificationBoundaryEnd, -1, 'Header notification state boundary is incomplete');
  assert.notEqual(premiumNotificationStart, -1, 'active premium notification sheet is missing');
  assert.notEqual(premiumNotificationEnd, -1, 'active premium notification sheet is incomplete');
  assert.notEqual(canonicalProjectionStart, -1, 'Header canonical incident projection is missing');
  assert.notEqual(canonicalProjectionEnd, -1, 'Header canonical incident projection is incomplete');
  assert.notEqual(notificationTriggerTruthStart, -1, 'notification trigger truth projection is missing');
  assert.notEqual(notificationTriggerTruthEnd, -1, 'notification trigger truth projection is incomplete');

  const preGeometry = source.slice(sharedTopbarStart, notificationBoundaryEnd);
  const projection = source.slice(canonicalProjectionStart, canonicalProjectionEnd);
  assert.doesNotMatch(preGeometry, /\/api\/events|notificationPoll|readEventRows|notifLiveEvents|groupNotifications|curateNotifications/);
  assert.match(source.slice(sharedTopbarStart, canonicalProjectionStart), /const productSnapshot = productBinding\.snapshot/);
  assert.match(projection, /productBinding\.continuity === 'PROVEN'/);
  assert.match(projection, /productSnapshot\.incidentAvailability/);
  assert.match(projection, /productSnapshot\.incidents/);
  assert.match(projection, /projectCanonicalIncidentNotifications/);

  const premiumNotification = source.slice(premiumNotificationStart, premiumNotificationEnd);
  assert.match(premiumNotification, /notificationFeedStatus/);
  assert.match(premiumNotification, /canonicalNotificationState\.status === 'CURRENT'/);
  assert.doesNotMatch(premiumNotification, /notificationFeedState/);
  assert.match(premiumNotification, /Last-Known Feed/);
  assert.match(premiumNotification, /Notification Feed Unavailable/);
  assert.match(premiumNotification, /Feed Loading/);
  assert.match(premiumNotification, /incident\.count[\s\S]*incident\.state[\s\S]*incident\.routing\.externalPaging\.state/);
  assert.match(premiumNotification, /No Durable Incident Episodes/);
  assert.match(premiumNotification, /not a derived system all-clear/);

  const notificationTriggerTruth = source.slice(notificationTriggerTruthStart, notificationTriggerTruthEnd);
  assert.match(notificationTriggerTruth, /status === 'CURRENT'[\s\S]*'no unread incidents'/);
  assert.match(notificationTriggerTruth, /status === 'STALE'[\s\S]*last-known unread[\s\S]*last-known feed/);
  assert.match(notificationTriggerTruth, /status === 'UNAVAILABLE'[\s\S]*feed unavailable[\s\S]*feed loading/);
  assert.match(source, /title: `Notifications — \$\{notificationTriggerTruth\} · feed \$\{notificationFeedStatus\}`/);
  assert.doesNotMatch(source, /title: `Notifications — \$\{unread \?/);

  assert.match(page, /projectCanonicalIncidentNotifications/);
  assert.match(page, /IncidentAcknowledgementButton/);
  assert.match(page, /External Paging NOT_CONFIGURED/);
  assert.match(page, /Mark \$\{unread\} Read/);
  assert.doesNotMatch(page, /groupNotifications|curateNotifications|\/api\/events/);
  assert.match(selector, /One-to-one browser presentation of server-grouped durable incident episodes/);
  assert.doesNotMatch(selector, /new Map|groupNotifications|curateNotifications/);
});
