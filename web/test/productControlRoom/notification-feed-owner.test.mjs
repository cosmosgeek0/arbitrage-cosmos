import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), 'utf8');

test('Header and NotificationsPage consume the canonical incident owner without a raw-event bootstrap', async () => {
  const [app, header, page] = await Promise.all([
    read('App.tsx'),
    read('components/Header.tsx'),
    read('pages/NotificationsPage.tsx'),
  ]);

  assert.doesNotMatch(app, /NotificationFeedProvider|notificationFeed/);
  assert.doesNotMatch(header, /useNotificationFeed|notificationFeedState/);
  assert.doesNotMatch(page, /useNotificationFeed|notificationFeedState/);
  assert.doesNotMatch(header, /\/api\/events\?/);
  assert.doesNotMatch(page, /\/api\/events\?/);
  assert.match(header, /projectCanonicalIncidentNotifications/);
  assert.match(page, /projectCanonicalIncidentNotifications/);
});
