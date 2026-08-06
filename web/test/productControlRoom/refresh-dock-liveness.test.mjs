import assert from 'node:assert/strict';
import test from 'node:test';

import { createDelayedResetOwner } from '../../src/lib/polling.ts';

// The floating bottom-right RefreshDock (Connection Watchman) launcher is
// retired; the Watchdog page (web/src/pages/Watchdog.tsx) is the site's
// view-only connections/lag observatory. The two source-shape contracts that
// pinned the dock's health probe and recovery handler are gone with it. The
// shared delayed-reset owner outlives the dock, so its contract stays here.

test('delayed recovery reset cannot overwrite a newer in-flight status', () => {
  let nextHandle = 0;
  const pending = new Map();
  const cancelled = [];
  const owner = createDelayedResetOwner({
    schedule(task, delayMs) {
      const handle = ++nextHandle;
      pending.set(handle, { task, delayMs });
      return handle;
    },
    cancel(handle) {
      cancelled.push(handle);
      pending.delete(handle);
    },
  });
  const states = [];

  owner.schedule(2_400, () => states.push('obsolete-idle'));
  assert.equal(owner.pending(), true);
  owner.cancel();
  states.push('new-spin');
  owner.schedule(1_500, () => states.push('current-idle'));

  assert.deepEqual(cancelled, [1]);
  assert.equal(pending.has(1), false);
  assert.equal(pending.get(2).delayMs, 1_500);
  assert.deepEqual(states, ['new-spin']);
  pending.get(2).task();
  assert.deepEqual(states, ['new-spin', 'current-idle']);
  assert.equal(owner.pending(), false);
});
