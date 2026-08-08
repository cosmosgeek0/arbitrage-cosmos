import type { BasisRow, BasisSnapshot } from '../lib/basisRuntime';

export function borrowStatusLabel(row: BasisRow): string {
  if (row.borrow.status === 'available') return row.borrow.ok ? 'Eligible' : 'Blocked';
  if (row.borrow.status === 'unavailable') return 'Unavailable';
  if (row.borrow.status === 'unknown') return 'Unknown';
  return 'Not Required';
}

export function borrowStatusTone(row: BasisRow): string {
  if (row.borrow.status === 'available') return row.borrow.ok ? 'available' : 'unavailable';
  return row.borrow.status;
}

export function hasObservedBorrowCost(row: BasisRow): boolean {
  return row.borrow.status === 'available' && row.borrow.rejectCode !== 'borrow_too_small';
}

export function selectBorrowPreflightRows(
  basis: Pick<BasisSnapshot, 'rows'> | null,
  basisCurrent: boolean,
): BasisRow[] {
  if (!basisCurrent || basis === null) return [];
  return basis.rows
    .filter((row) => row.direction === 'short_spot_long_perp')
    .sort((a, b) => (b.executableGapPct ?? Number.NEGATIVE_INFINITY) - (a.executableGapPct ?? Number.NEGATIVE_INFINITY));
}
