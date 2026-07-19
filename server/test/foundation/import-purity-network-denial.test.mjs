import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  FOUNDATION_FETCH_DENIED,
  installFoundationFetchDenial,
} from './import-purity-network-denial.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const WRAPPERS = [
  'borrow/import-purity.mjs',
  'calibration/import-purity.mjs',
  'contracts/import-purity.mjs',
  'exchange/binanceUsdM/import-purity.mjs',
  'execution/import-purity.mjs',
  'integration/import-purity.mjs',
  'observability/import-purity.mjs',
  'reconciliation/import-purity.mjs',
  'replay/import-purity.mjs',
  'scenarios/import-purity.mjs',
];

test('every Foundation import-purity wrapper installs deterministic fetch denial', () => {
  for (const relativePath of WRAPPERS) {
    const source = readFileSync(
      path.join(ROOT, 'server/test/foundation', relativePath),
      'utf8',
    );
    assert.match(source, /installFoundationFetchDenial/u, relativePath);
    assert.doesNotMatch(source, /return\s+realFetch|realFetch\.apply/u, relativePath);
  }
});

test('the shared wrapper trap proves a real attempted channel fails synchronously', () => {
  const originalFetch = globalThis.fetch;
  const denial = installFoundationFetchDenial();
  try {
    assert.equal(denial.negativeControlProven, true);
    assert.throws(
      () => globalThis.fetch('https://foundation.invalid/hostile-attempt'),
      (error) => error?.code === FOUNDATION_FETCH_DENIED,
    );
    assert.equal(denial.attempts(), 1);
  } finally {
    denial.restore();
  }
  assert.equal(globalThis.fetch, originalFetch);
});
