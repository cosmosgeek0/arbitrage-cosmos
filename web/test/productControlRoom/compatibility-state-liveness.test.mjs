import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  INITIAL_COMPATIBILITY_STATE_TRUTH,
  reduceCompatibilityStateTruth,
} from '../../src/store.tsx';

test('compatibility state distinguishes unavailable, current, and retained stale truth', async () => {
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
  for (const source of [dashboard, risk]) {
    assert.match(source, /stateStatus/);
    assert.match(source, /STALE LAST-KNOWN/);
    assert.match(source, /UNAVAILABLE/);
  }
});
