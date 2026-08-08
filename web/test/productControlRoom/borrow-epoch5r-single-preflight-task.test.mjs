import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  borrowStatusLabel,
  borrowStatusTone,
  hasObservedBorrowCost,
  selectBorrowPreflightRows,
} from '../../src/pages/borrowPreflightTruth.ts';

const read = (path) => readFile(new URL('../../src/' + path, import.meta.url), 'utf8');

const requiredBorrowTruthFields = Object.freeze([
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

const borrowRow = ({
  symbol = 'BTCUSDT',
  direction = 'short_spot_long_perp',
  executableGapPct = 0.25,
  status = 'available',
  ok = true,
  rejectCode = null,
  costPctOverHold = 0.02,
} = {}) => ({
  symbol,
  base: symbol.replace('USDT', ''),
  direction,
  executableGapPct,
  borrow: {
    status,
    ok,
    rejectCode,
    costPctOverHold,
  },
});

test('Borrow preflight helpers fail closed on blocked cost and non-current rows', () => {
  const eligible = borrowRow();
  const tooSmall = borrowRow({ ok: false, rejectCode: 'borrow_too_small', costPctOverHold: 0 });
  const tooExpensive = borrowRow({ ok: false, rejectCode: 'borrow_cost_too_high', costPctOverHold: 0.5 });
  const unavailable = borrowRow({ status: 'unavailable', ok: false, rejectCode: 'borrow_unavailable', costPctOverHold: 0 });

  assert.equal(borrowStatusLabel(eligible), 'Eligible');
  assert.equal(borrowStatusTone(eligible), 'available');
  assert.equal(borrowStatusLabel(tooSmall), 'Blocked');
  assert.equal(borrowStatusTone(tooSmall), 'unavailable');
  assert.equal(hasObservedBorrowCost(tooSmall), false);
  assert.equal(hasObservedBorrowCost(tooExpensive), true);
  assert.equal(borrowStatusLabel(unavailable), 'Unavailable');
  assert.equal(hasObservedBorrowCost(unavailable), false);

  const lower = borrowRow({ symbol: 'LOWUSDT', executableGapPct: 0.1 });
  const higher = borrowRow({ symbol: 'HIGHUSDT', executableGapPct: 0.4 });
  const forward = borrowRow({ symbol: 'FORWARDUSDT', direction: 'long_spot_short_perp', executableGapPct: 0.9 });
  const snapshot = { rows: [lower, forward, higher] };

  assert.deepEqual(selectBorrowPreflightRows(snapshot, false), []);
  assert.deepEqual(selectBorrowPreflightRows(null, true), []);
  assert.deepEqual(
    selectBorrowPreflightRows(snapshot, true).map((row) => row.symbol),
    ['HIGHUSDT', 'LOWUSDT'],
  );
});

test('Borrow composes bounded public preflight truth with the shared guarded private-read owner', async () => {
  const [page, model] = await Promise.all([
    read('pages/Loans.tsx'),
    read('lib/productIntegration/model.ts'),
  ]);

  assert.match(page, /const \{ privateRead, privateReadError, openDetail, setPage \} = useStore\(\)/);
  assert.match(page, /projectPrivateRead\(privateRead\)/);
  assert.match(page, /privateRead\.margin\.assets\?\.filter\(hasMarginLiability\)/);
  assert.match(page, /privateRead\.reconciliation\.liabilities\.state/);
  assert.match(page, /privatePresentation\.freshness\.label/);
  assert.match(page, /privatePresentation\.guardTone/);
  assert.match(page, /Borrowed And Accrued Interest Remain In Asset Units/);
  assert.match(page, /Owner Gated/);

  assert.match(page, /createSettledPoll<BasisSnapshot>/);
  assert.match(page, /decodeBasisRuntimeSnapshot/);
  assert.match(page, /fetchJson<unknown>\('\/api\/engine\/basis', \{ cache: 'no-store', signal \}\)/);
  assert.match(page, /basisRuntimeSnapshotCurrent\(basis, nowMs\)/);
  assert.match(page, /selectBorrowPreflightRows\(basis, basisCurrent\)/);
  assert.match(page, /row\.base\.includes\(query\) \|\| row\.symbol\.includes\(query\)/);
  assert.match(page, /borrowStatusTone\(row\)/);
  assert.match(page, /hasObservedBorrowCost\(row\)/);
  assert.match(page, /<ProductSurfaceAdapter surfaceId="borrow" \/>/);
  assert.match(page, /Private Rate Not Assumed/);
  assert.match(page, /className="borrowx-asset borrowx-row-link"/);
  assert.match(page, /onClick=\{\(\) => setPage\('strategies'\)\}/);
  assert.match(page, /basisCurrent \? 'Engine-Verified Capacity And Rate' : 'UNKNOWN'/);
  assert.match(page, /basisCurrent \? 'Named Borrow Rejection' : 'UNKNOWN'/);

  assert.doesNotMatch(page, /method:\s*['"]POST|borrowRepay|\/api\/(?:orders?|trade|live|kill)/i);
  assert.doesNotMatch(page, /\?\?\s*0/);

  const borrowFieldList = model.match(/borrow:\s*Object\.freeze\(\[([\s\S]*?)\]\),\s*\n\s*execution:/)?.[1] ?? '';
  assert.ok(borrowFieldList, 'canonical Borrow truth field list must remain present');
  assert.equal([...borrowFieldList.matchAll(/['"]([^'"]+)['"]/g)].length, requiredBorrowTruthFields.length);
  for (const field of requiredBorrowTruthFields) {
    assert.match(borrowFieldList, new RegExp('[\'"]' + field + '[\'"]'), field);
  }
});
