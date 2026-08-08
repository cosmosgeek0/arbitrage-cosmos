import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  INITIAL_COMPATIBILITY_STATE_TRUTH,
  reduceCompatibilityStateTruth,
} from '../../src/store.tsx';

test('compatibility state remains explicit while delegated Dashboard consumes only canonical Product truth', async () => {
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
  assert.match(dashboard, /binding\.snapshot\?\.dashboard/);
  assert.match(dashboard, /Material-event continuity is \$\{binding\.continuity\}/);
  assert.doesNotMatch(dashboard, /stateStatus|STALE LAST-KNOWN|reduceCompatibilityStateTruth/);
});
