import {
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  type ExactDecimal,
  type NonNegativeDecimal,
} from '../../../capitalFoundation/contracts/decimal.js';

const EXACT_RAW = /^-?\d+(?:\.\d+)?$/;
const NON_NEGATIVE_RAW = /^\d+(?:\.\d+)?$/;
const MAXIMUM_DECIMAL_CHARACTERS = 97;

function validateRaw(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAXIMUM_DECIMAL_CHARACTERS
    || value.trim() !== value || !pattern.test(value)) {
    throw new TypeError(`${label} must be an exact plain-decimal string`);
  }
  return value;
}

export function normalizePrivateExactDecimal(value: unknown, label = 'private decimal'): ExactDecimal {
  return normalizeExactDecimal(validateRaw(value, EXACT_RAW, label));
}

export function normalizePrivateNonNegativeDecimal(
  value: unknown,
  label = 'private non-negative decimal',
): NonNegativeDecimal {
  return normalizeNonNegativeExactDecimal(validateRaw(value, NON_NEGATIVE_RAW, label));
}

export function normalizeNullablePrivateExactDecimal(
  value: unknown,
  label = 'nullable private decimal',
): ExactDecimal | null {
  return value === null ? null : normalizePrivateExactDecimal(value, label);
}

export function normalizeNullablePrivateNonNegativeDecimal(
  value: unknown,
  label = 'nullable private non-negative decimal',
): NonNegativeDecimal | null {
  return value === null ? null : normalizePrivateNonNegativeDecimal(value, label);
}
