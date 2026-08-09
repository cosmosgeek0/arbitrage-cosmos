import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  INITIAL_COMPATIBILITY_STATE_TRUTH,
  reduceCompatibilityStateTruth,
} from '../../src/store.tsx';

test('compatibility state remains explicit while the owner Dashboard consumes canonical Product truth', async () => {
  const unavailable = reduceCompatibilityStateTruth(INITIAL_COMPATIBILITY_STATE_TRUTH, {
    kind: 'FAILURE',
    observedAtMs: 100,
    error: 'state read failed',
  });
  assert.deepEqual(unavailable, {
    status: 'UNAVAILABLE',
    lastSuccessAtMs: null,
    error: 'state read failed',
  });

  const current = reduceCompatibilityStateTruth(unavailable, {
    kind: 'SUCCESS',
    observedAtMs: 200,
  });
  assert.deepEqual(current, {
    status: 'CURRENT',
    lastSuccessAtMs: 200,
    error: null,
  });

  const stale = reduceCompatibilityStateTruth(current, {
    kind: 'FAILURE',
    observedAtMs: 300,
    error: 'state refresh failed',
  });
  assert.deepEqual(stale, {
    status: 'STALE',
    lastSuccessAtMs: 200,
    error: 'state refresh failed',
  });

  const dashboard = await readFile(new URL('../../src/pages/Dashboard.tsx', import.meta.url), 'utf8');
  const risk = await readFile(new URL('../../src/pages/Risk.tsx', import.meta.url), 'utf8');
  assert.match(risk, /stateStatus/);
  assert.match(risk, /STALE LAST-KNOWN/);
  assert.match(risk, /UNAVAILABLE/);
  assert.match(dashboard, /useProductControlRoomContext/);
  assert.match(dashboard, /productBinding\.snapshot/);
  assert.match(dashboard, /Product continuity \$\{productBinding\.continuity\}/);
  // The owner page surfaces the compatibility-state truth itself rather than
  // hiding it behind a delegate, but it must never re-derive the reducer.
  assert.match(dashboard, /stateStatus !== 'CURRENT'/);
  assert.match(dashboard, /STALE LAST-KNOWN/);
  assert.doesNotMatch(dashboard, /reduceCompatibilityStateTruth/);
});
