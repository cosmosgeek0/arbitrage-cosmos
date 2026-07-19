import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8');

test('App mounts one notification event poll owner shared by Header and NotificationsPage', async () => {
  const [app, owner, header, page] = await Promise.all([
    read('App.tsx'),
    read('lib/notificationFeed.tsx'),
    read('components/Header.tsx'),
    read('pages/NotificationsPage.tsx'),
  ]);

  assert.equal((app.match(/<NotificationFeedProvider>/g) ?? []).length, 1);
  assert.match(app, /<NotificationFeedProvider>[\s\S]*<Shell \/>[\s\S]*<\/NotificationFeedProvider>/);

  assert.match(owner, /export function NotificationFeedProvider/);
  assert.equal((owner.match(/createSettledPoll</g) ?? []).length, 1, 'only the shared feed owner may poll notification events');
  assert.match(owner, /readEventRows\('\/api\/events\?limit=1', signal\)/);
  assert.match(owner, /Promise\.allSettled\(attemptedKinds\.map/);
  assert.match(owner, /pendingBootstrapKinds = attemptedKinds\.filter/);
  assert.match(owner, /retainNotificationArchive\(current\.archive, items, cutoff\)/);
  assert.match(owner, /return notificationPoll\.stop/);

  assert.match(header, /useNotificationFeed\(\)/);
  assert.match(page, /useNotificationFeed\(\)/);
  assert.doesNotMatch(header, /\/api\/events\?/);
  assert.doesNotMatch(page, /\/api\/events\?/);
  assert.doesNotMatch(header, /pendingBootstrapKinds|notificationPoll/);
  assert.doesNotMatch(page, /cursorRef|bootstrapHighWater|relevantKinds/);
});
