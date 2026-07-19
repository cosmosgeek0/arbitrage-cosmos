import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MAX_NOTIFICATION_CURSOR,
  parseNotificationCursor,
} from '../../src/lib/notificationCursor.ts';

test('notification cursor accepts only canonical nonnegative safe integers', () => {
  assert.equal(MAX_NOTIFICATION_CURSOR, Number.MAX_SAFE_INTEGER);
  assert.equal(parseNotificationCursor('0'), 0);
  assert.equal(parseNotificationCursor('42'), 42);
  assert.equal(parseNotificationCursor(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);

  for (const malformed of [
    null,
    undefined,
    '',
    ' ',
    'NaN',
    'Infinity',
    '-1',
    '1.5',
    '1e3',
    '0x10',
    '01',
    String(Number.MAX_SAFE_INTEGER + 1),
  ]) {
    assert.equal(parseNotificationCursor(malformed), 0, `must reject ${String(malformed)}`);
  }
});

test('Header and NotificationsPage share the notification cursor parser', async () => {
  const [header, notificationsPage] = await Promise.all([
    readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8'),
  ]);
  const parserCall = /parseNotificationCursor\(localStorage\.getItem\('cosmos-notif-seen'\)\)/g;

  assert.equal(header.match(parserCall)?.length, 2, 'both Header notification cursors must use the shared parser');
  assert.equal(notificationsPage.match(parserCall)?.length, 1, 'NotificationsPage cursor must use the shared parser');
  assert.doesNotMatch(header, /Number\(localStorage\.getItem\('cosmos-notif-seen'\)/);
  assert.doesNotMatch(notificationsPage, /Number\(localStorage\.getItem\('cosmos-notif-seen'\)/);
});
