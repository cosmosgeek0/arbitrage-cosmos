import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  OPTIONAL_SURFACE_EVIDENCE,
  REQUIRED_SURFACE_EVIDENCE,
  productSurfaceReadinessBlocker,
} from '../../src/lib/productIntegration/model.ts';
import { hasMarginLiability, projectPrivateRead, unavailablePrivateRead } from '../../src/lib/privateRead.ts';

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
  assert.match(source, /const \{ privateRead, privateReadError, privateReadSource, openDetail, setPage \} = useStore\(\)/);
  assert.match(source, /projectPrivateReadGuard\(\{[\s\S]*source: privateReadSource,[\s\S]*error: privateReadError/);
  assert.match(source, /privateRead\.margin\.assets\?\.filter/);
  assert.match(source, /privateRead\.margin\.totalLiabilityBtc/);
  assert.match(source, /privateRead\.reconciliation\.liabilities\.state/);
  assert.match(source, /Borrowed And Accrued Interest Remain In Asset Units/);
  assert.doesNotMatch(source, /\/api\/loans/);
  assert.doesNotMatch(source, /fetchJson[^;]*\/api\/private-account/);
  assert.doesNotMatch(source, /<button[^>]*>\s*(?:Borrow|Repay|Transfer|Withdraw)/i);
});

test('normalized zero liabilities stay zero and unavailable liabilities stay unknown on Borrow', async () => {
  const source = await readFile(loansUrl, 'utf8');
  // The page classifies liabilities through the shared owner, so a fixed-scale
  // provider zero cannot be re-read as an outstanding borrow.
  assert.match(source, /privateRead\.margin\.assets\?\.filter\(hasMarginLiability\)/);
  assert.doesNotMatch(source, /borrowed !== '0'|interest !== '0'/);
  assert.match(source, /privatePresentation\.freshness\.label/);
  assert.match(source, /privateReadGuard\.overallTone/);
  assert.match(source, /const currentExactEmptyLiabilities = liabilityRows !== null[\s\S]*liabilityRows\.length === 0[\s\S]*privateReadGuard\.commonTone === 'ok'[\s\S]*privateReadGuard\.sourceGuardTone === 'ok'[\s\S]*privateRead\.margin\.coverage\.state === 'COMPLETE_CURRENT'[\s\S]*privateRead\.reconciliation\.liabilities\.state === 'RECONCILED'/);
  assert.match(source, /const liabilityCount = liabilityRows === null \|\| \(liabilityRows\.length === 0 && !currentExactEmptyLiabilities\)/);
  assert.match(source, /assets: privateRead\.margin\.assets === null[\s\S]*privateRead\.margin\.assets\.length === 0 && !currentExactEmptyLiabilities[\s\S]*String\(privateRead\.margin\.assets\.length\)/);
  assert.match(source, /currentExactEmptyLiabilities \? \([\s\S]*No Margin Liabilities[\s\S]*Current Liability Absence Unknown/);
  assert.match(source, /privateObservationLabel\} · current absence UNKNOWN/);

  const zeroRow = { asset: 'USDT', free: '8.00000000', locked: '0.00000000', borrowed: '0.00000000', interest: '0.00000000', netAsset: '8.00000000' };
  const negativeZeroRow = { ...zeroRow, asset: 'BNB', borrowed: '-0.00000000', interest: '0' };
  const borrowedRow = { ...zeroRow, asset: 'BTC', borrowed: '0.00000000', interest: '0.00000001' };
  assert.equal(hasMarginLiability(zeroRow), false);
  assert.equal(hasMarginLiability(negativeZeroRow), false);
  assert.equal(hasMarginLiability(borrowedRow), true);
  assert.equal([zeroRow, negativeZeroRow, borrowedRow].filter(hasMarginLiability).length, 1);

  // Absent liability truth is never presented as an observed zero.
  const unavailable = projectPrivateRead(unavailablePrivateRead('PRIVATE_READ_REQUEST_FAILED'));
  assert.equal(unavailable.counts.liabilities, null);
  assert.equal(unavailable.marginLiabilityBtc, null);
  assert.equal(unavailable.guardTone, 'bad');
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
