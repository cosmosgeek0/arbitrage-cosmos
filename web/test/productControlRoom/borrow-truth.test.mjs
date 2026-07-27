import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  OPTIONAL_SURFACE_EVIDENCE,
  REQUIRED_SURFACE_EVIDENCE,
  productSurfaceReadinessBlocker,
} from '../../src/lib/productIntegration/model.ts';

const loansUrl = new URL('../../src/pages/Loans.tsx', import.meta.url);

test('Borrow preserves canonical preflight evidence and projects sanitized private liabilities through the shared store', async () => {
  assert.deepEqual(REQUIRED_SURFACE_EVIDENCE.borrow, [
    'mode-eligibility',
    'borrow-eligibility',
    'maximum-borrowable',
    'borrow-limit',
    'hourly-borrow-rate',
    'current-borrowed',
    'accrued-interest',
    'collateral-amount',
    'collateral-asset',
    'current-ltv',
    'liability-source-freshness',
    'collateral-source-freshness',
    'blocker',
  ]);
  assert.deepEqual(OPTIONAL_SURFACE_EVIDENCE.borrow, [
    'collateral-amount',
    'collateral-asset',
    'current-ltv',
    'collateral-source-freshness',
  ]);

  const source = await readFile(loansUrl, 'utf8');
  assert.match(source, /const \{ privateRead, privateReadError, openDetail, setPage \} = useStore\(\)/);
  assert.match(source, /projectPrivateRead\(privateRead\)/);
  assert.match(source, /privateRead\.margin\.assets\?\.filter/);
  assert.match(source, /privateRead\.margin\.totalLiabilityBtc/);
  assert.match(source, /privateRead\.reconciliation\.liabilities\.state/);
  assert.match(source, /Borrowed And Accrued Interest Remain In Asset Units/);
  assert.doesNotMatch(source, /\/api\/loans/);
  assert.doesNotMatch(source, /fetchJson[^;]*\/api\/private-account/);
  assert.doesNotMatch(source, /<button[^>]*>\s*(?:Borrow|Repay|Transfer|Withdraw)/i);
});

test('isolated liability or LTV values cannot fabricate a ready canonical Borrow surface', () => {
  const evidence = REQUIRED_SURFACE_EVIDENCE.borrow.map((fieldId) => ({
    fieldId,
    label: fieldId,
    value: null,
    truthLabel: 'MISSING',
    canonicalSource: `systemIntegration:borrow:${fieldId}`,
    unavailableReason: 'CANONICAL_OWNER_FIELD_NOT_CONFIGURED',
  }));
  assert.equal(
    productSurfaceReadinessBlocker({ surfaceId: 'borrow', evidence }),
    'REQUIRED_EVIDENCE_MISSING:mode-eligibility',
  );

  for (const fieldId of ['current-borrowed', 'accrued-interest', 'collateral-amount', 'current-ltv']) {
    const hostile = evidence.map((datum) => ({
      ...datum,
      value: datum.fieldId === fieldId ? '0' : datum.value,
      truthLabel: datum.fieldId === fieldId ? 'WIRED' : datum.truthLabel,
    }));
    assert.notEqual(productSurfaceReadinessBlocker({ surfaceId: 'borrow', evidence: hostile }), null);
  }

  const optionalFields = new Set(OPTIONAL_SURFACE_EVIDENCE.borrow);
  const requiredComplete = evidence.map((datum) => ({
    ...datum,
    value: optionalFields.has(datum.fieldId) ? null : 'OWNER_EVIDENCED',
    truthLabel: optionalFields.has(datum.fieldId) ? 'MISSING' : 'WIRED',
    unavailableReason: optionalFields.has(datum.fieldId) ? 'OPTIONAL_OWNER_NOT_AVAILABLE' : null,
  }));
  assert.equal(
    productSurfaceReadinessBlocker({ surfaceId: 'borrow', evidence: requiredComplete }),
    null,
    'optional collateral/LTV stays visible and unknown without blocking required preflight',
  );
  for (const fieldId of ['current-borrowed', 'accrued-interest', 'liability-source-freshness']) {
    const missingRequired = requiredComplete.map((datum) => datum.fieldId === fieldId
      ? { ...datum, value: null, truthLabel: 'MISSING' }
      : datum);
    assert.equal(
      productSurfaceReadinessBlocker({ surfaceId: 'borrow', evidence: missingRequired }),
      `REQUIRED_EVIDENCE_MISSING:${fieldId}`,
    );
  }
});
