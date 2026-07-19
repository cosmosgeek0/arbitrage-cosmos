import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';

test('notification archive retention reports every row discarded by its in-app bound', async (context) => {
  const cssHooks = registerHooks({
    load(url, hookContext, nextLoad) {
      if (!url.endsWith('.css')) return nextLoad(url, hookContext);
      return { format: 'module', shortCircuit: true, source: '' };
    },
  });
  context.after(() => cssHooks.deregister());

  const {
    NOTIFICATION_ARCHIVE_LIMIT,
    retainNotificationArchive,
  } = await import('../../src/pages/NotificationsPage.tsx');

  const cutoff = 1_000;
  const incoming = Array.from({ length: NOTIFICATION_ARCHIVE_LIMIT + 5 }, (_, index) => ({
    id: index + 1,
    ts: cutoff + index + 1,
    kind: 'error_event',
    data: {},
  }));
  const bounded = retainNotificationArchive({ events: [], droppedCount: 0 }, incoming, cutoff);

  assert.equal(bounded.events.length, NOTIFICATION_ARCHIVE_LIMIT);
  assert.equal(bounded.events[0]?.id, NOTIFICATION_ARCHIVE_LIMIT + 5);
  assert.equal(bounded.events.at(-1)?.id, 6);
  assert.equal(bounded.droppedCount, 5);

  const next = retainNotificationArchive(bounded, [{
    id: NOTIFICATION_ARCHIVE_LIMIT + 6,
    ts: cutoff + NOTIFICATION_ARCHIVE_LIMIT + 6,
    kind: 'error_event',
    data: {},
  }], cutoff);
  assert.equal(next.events.length, NOTIFICATION_ARCHIVE_LIMIT);
  assert.equal(next.droppedCount, 6, 'the visible count must include rows discarded by later merges');

  const source = await readFile(new URL('../../src/pages/NotificationsPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /Archive View Truncated/);
  assert.match(source, /archive\.droppedCount\.toLocaleString\(\)/);
  assert.match(source, /Event Rows Not Retained This Session/);
  assert.doesNotMatch(source, /sort\(\(a, b\) => b\.ts - a\.ts \|\| b\.id - a\.id\)\.slice\(0, 10_000\)/);
});
