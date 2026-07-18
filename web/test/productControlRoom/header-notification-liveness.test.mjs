import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const headerUrl = new URL('../../src/components/Header.tsx', import.meta.url);

test('premium Header notification polling is bounded and exposes last-known feed truth', async () => {
  const source = await readFile(headerUrl, 'utf8');
  const sharedTopbarStart = source.indexOf('function SharedTopBar()');
  const notificationReaderStart = source.indexOf('const readEventRows = async', sharedTopbarStart);
  const notificationPollStart = source.indexOf('const notificationPoll = createSettledPoll<{', sharedTopbarStart);
  const notificationPollEnd = source.indexOf('// Compute the box geometry', notificationPollStart);
  const premiumStart = source.indexOf('const premiumContent', sharedTopbarStart);
  const premiumNotificationStart = source.indexOf("case 'notif':", premiumStart);
  const premiumNotificationEnd = source.indexOf("case 'power':", premiumNotificationStart);
  const notificationTriggerTruthStart = source.indexOf('const notificationTriggerTruth =', sharedTopbarStart);
  const notificationTriggerTruthEnd = source.indexOf('const notificationFeedDetail =', notificationTriggerTruthStart);

  assert.notEqual(notificationPollStart, -1, 'Header must use the shared settled-poll owner for notifications');
  assert.notEqual(notificationReaderStart, -1, 'Header must route notification reads through the shared HTTP helper');
  assert.notEqual(notificationPollEnd, -1, 'notification polling block is incomplete');
  assert.notEqual(premiumNotificationStart, -1, 'active premium notification sheet is missing');
  assert.notEqual(premiumNotificationEnd, -1, 'active premium notification sheet is incomplete');
  assert.notEqual(notificationTriggerTruthStart, -1, 'notification trigger truth projection is missing');
  assert.notEqual(notificationTriggerTruthEnd, -1, 'notification trigger truth projection is incomplete');

  const notificationEffect = source.slice(notificationReaderStart, notificationPollEnd);
  const poll = source.slice(notificationPollStart, notificationPollEnd);
  assert.match(poll, /intervalMs:\s*5_000/);
  assert.match(poll, /timeoutMs:\s*15_000/);
  assert.match(poll, /request:\s*async \(signal\)/);
  assert.match(notificationEffect, /fetchJson<LedgerEvent\[]>\([^;]+\{[^}]*signal/s);
  assert.match(poll, /onSuccess:[\s\S]*status:\s*'CURRENT'[\s\S]*lastSuccessAt:\s*Date\.now\(\)/);
  assert.match(poll, /onError:[\s\S]*status:\s*current\.lastSuccessAt === null \? 'UNAVAILABLE' : 'STALE'/);
  assert.match(poll, /apiErrorMessage\(error,\s*'Notification feed unavailable'\)/);
  assert.match(poll, /notificationPoll\.start\(\)/);
  assert.match(poll, /return notificationPoll\.stop/);
  assert.match(notificationEffect, /let pendingBootstrapKinds = \[\.\.\.relevantKinds\]/);
  assert.match(poll, /Promise\.allSettled\(attemptedKinds\.map/);
  assert.match(poll, /items = bootstrapReads\.flatMap\(\(result\) => result\.status === 'fulfilled' \? result\.value : \[\]\)/);
  assert.match(poll, /pendingBootstrapKinds = attemptedKinds\.filter\(\(_, index\) => bootstrapReads\[index\]\?\.status === 'rejected'\)/);
  assert.match(poll, /onSuccess: \(\{ items, bootstrapFailures, bootstrapSuccesses \}\) =>/);
  assert.match(poll, /bootstrapFailures > 0[\s\S]*status: current\.lastSuccessAt === null && bootstrapSuccesses === 0 \? 'UNAVAILABLE' : 'STALE'/);
  assert.doesNotMatch(poll, /bootstrapReads\.find\(\(result\) => result\.status === 'rejected'\)/);
  assert.doesNotMatch(poll, /throw bootstrapFailure\.reason/);
  assert.doesNotMatch(poll, /Promise\.all\(/);
  assert.doesNotMatch(notificationEffect, /window\.setInterval|\bfetch\(/);

  const premiumNotification = source.slice(premiumNotificationStart, premiumNotificationEnd);
  assert.match(premiumNotification, /notificationFeedStatus/);
  assert.match(premiumNotification, /notificationFeedState\.status === 'CURRENT'/);
  assert.match(premiumNotification, /Last-Known Feed/);
  assert.match(premiumNotification, /Notification Feed Unavailable/);
  assert.match(premiumNotification, /Feed Loading/);

  const notificationTriggerTruth = source.slice(notificationTriggerTruthStart, notificationTriggerTruthEnd);
  assert.match(notificationTriggerTruth, /status === 'CURRENT'[\s\S]*'no unread events'/);
  assert.match(notificationTriggerTruth, /status === 'STALE'[\s\S]*last-known unread[\s\S]*last-known feed/);
  assert.match(notificationTriggerTruth, /status === 'UNAVAILABLE'[\s\S]*feed unavailable[\s\S]*feed loading/);
  assert.match(source, /title: `Notifications — \$\{notificationTriggerTruth\} · feed \$\{notificationFeedStatus\}`/);
  assert.doesNotMatch(source, /title: `Notifications — \$\{unread \?/);
});
