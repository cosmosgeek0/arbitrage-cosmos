import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  FX_MAX_SOURCE_AGE_MS,
  INITIAL_FX_TRUTH,
  reduceFxTruth,
  resolveFxRate,
} from '../../src/store.tsx';
import { fmtMoney, setFxRate } from '../../src/format.ts';

test('cached non-USD FX fails closed after failure or expiry while USD identity remains valid', async () => {
  const observedAtMs = 2_000_000_000;
  const current = reduceFxTruth(INITIAL_FX_TRUTH, {
    kind: 'SUCCESS',
    observedAtMs,
    payload: { rates: { INR: 83 }, fetchedAt: observedAtMs - 1_000 },
  });
  assert.equal(resolveFxRate(current, 'INR', observedAtMs).rate, 83);
  setFxRate(83, '₹', true);
  assert.equal(fmtMoney(100), '₹8.3K');

  const stale = reduceFxTruth(current, {
    kind: 'FAILURE',
    observedAtMs: observedAtMs + 2_000,
    error: 'fx refresh failed',
  });
  assert.equal(stale.status, 'STALE');
  assert.equal(stale.rates.INR, 83, 'cached evidence may be retained for diagnostics');
  const failedRate = resolveFxRate(stale, 'INR', observedAtMs + 2_000);
  assert.equal(failedRate.rate, null);
  setFxRate(failedRate.rate, '₹', failedRate.status === 'CURRENT');
  assert.equal(fmtMoney(100), '—');

  const expiredRate = resolveFxRate(current, 'INR', observedAtMs + FX_MAX_SOURCE_AGE_MS + 1);
  assert.equal(expiredRate.status, 'STALE');
  assert.equal(expiredRate.rate, null);

  const unavailable = reduceFxTruth(INITIAL_FX_TRUTH, {
    kind: 'FAILURE',
    observedAtMs,
    error: 'fx unavailable',
  });
  assert.equal(resolveFxRate(unavailable, 'INR', observedAtMs).status, 'UNAVAILABLE');

  const usdIdentity = resolveFxRate(unavailable, 'USD', observedAtMs);
  assert.deepEqual(usdIdentity, { status: 'CURRENT', rate: 1 });
  setFxRate(usdIdentity.rate, '$', true);
  assert.equal(fmtMoney(100), '$100');

  const header = await readFile(new URL('../../src/components/Header.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(header, /fetch\(['"]\/api\/fx/);
});
