import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTIFICATION_BOOTSTRAP_CONCURRENCY,
  pendingNotificationKindsAfterBatch,
  planNotificationBootstrapBatch,
} from '../../src/lib/notificationFeed.tsx';

const KINDS = Array.from({ length: 22 }, (_, index) => `kind-${index + 1}`);

test('notification bootstrap admits only a fixed small batch per settled cadence', () => {
  let pending = [...KINDS];
  const attempted = [];
  let cadences = 0;

  while (pending.length > 0) {
    const batch = planNotificationBootstrapBatch(pending);
    assert.ok(batch.attempted.length > 0);
    assert.ok(batch.attempted.length <= NOTIFICATION_BOOTSTRAP_CONCURRENCY);
    assert.deepEqual([...batch.attempted, ...batch.deferred], pending);
    attempted.push(...batch.attempted);
    pending = batch.deferred;
    cadences += 1;
  }

  assert.equal(NOTIFICATION_BOOTSTRAP_CONCURRENCY, 2);
  assert.equal(cadences, 11);
  assert.deepEqual(attempted, KINDS);
});

test('notification bootstrap concurrency input cannot widen the production ceiling', () => {
  assert.equal(planNotificationBootstrapBatch(KINDS, 1).attempted.length, 1);
  assert.equal(
    planNotificationBootstrapBatch(KINDS, Number.MAX_SAFE_INTEGER).attempted.length,
    NOTIFICATION_BOOTSTRAP_CONCURRENCY,
  );
  assert.equal(
    planNotificationBootstrapBatch(KINDS, 0).attempted.length,
    NOTIFICATION_BOOTSTRAP_CONCURRENCY,
  );
});

test('a failed kind remains pending without starving deferred history kinds', () => {
  const first = planNotificationBootstrapBatch(KINDS);
  const pending = pendingNotificationKindsAfterBatch(first, [
    { status: 'rejected', reason: new Error('unavailable') },
    { status: 'fulfilled', value: [] },
  ]);

  assert.deepEqual(pending, [...KINDS.slice(2), KINDS[0]]);
  assert.deepEqual(
    planNotificationBootstrapBatch(pending).attempted,
    KINDS.slice(2, 4),
    'deferred streams advance before the failed stream is retried',
  );
  assert.throws(
    () => pendingNotificationKindsAfterBatch(first, []),
    /notification bootstrap settlement is incomplete/,
  );
});
