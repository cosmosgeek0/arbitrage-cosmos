import {
  addExactDecimals,
  compareExactDecimals,
  normalizeNonNegativeExactDecimal,
  type NonNegativeDecimal,
} from '../../../capitalFoundation/contracts/decimal.js';

const NON_NEGATIVE_RAW = /^\d+(?:\.\d+)?$/;
const MAXIMUM_DECIMAL_CHARACTERS = 97;
const MAXIMUM_AGGREGATE_QUANTITY_VALUES = 256;

function boundedQuantityValues(values: readonly string[]): void {
  if (!Array.isArray(values) || values.length > MAXIMUM_AGGREGATE_QUANTITY_VALUES) {
    throw new RangeError('journal quantity aggregate exceeds its closed bound');
  }
}

export function normalizeJournalQuantity(value: unknown, label = 'journal quantity'): NonNegativeDecimal {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAXIMUM_DECIMAL_CHARACTERS
    || value.trim() !== value || !NON_NEGATIVE_RAW.test(value)) {
    throw new TypeError(`${label} must be an exact non-negative plain-decimal string`);
  }
  return normalizeNonNegativeExactDecimal(value);
}

export function compareJournalQuantities(left: string, right: string): -1 | 0 | 1 {
  return compareExactDecimals(
    normalizeJournalQuantity(left, 'left journal quantity'),
    normalizeJournalQuantity(right, 'right journal quantity'),
  );
}

export function maximumJournalQuantity(values: readonly string[]): string {
  boundedQuantityValues(values);
  if (values.length === 0) return '0';
  let maximum = normalizeJournalQuantity(values[0], 'journal quantity');
  for (const value of values.slice(1)) {
    const normalized = normalizeJournalQuantity(value, 'journal quantity');
    if (compareExactDecimals(normalized, maximum) > 0) maximum = normalized;
  }
  return maximum;
}

export function sumJournalQuantities(values: readonly string[]): string {
  boundedQuantityValues(values);
  let total = normalizeJournalQuantity('0', 'journal quantity total');
  for (const value of values) {
    total = normalizeNonNegativeExactDecimal(
      addExactDecimals(total, normalizeJournalQuantity(value, 'journal quantity')),
    );
  }
  return total;
}
