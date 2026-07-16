import {
  addExactDecimals,
  compareExactDecimals,
  divideExactDecimals,
  minimumExactDecimal,
  multiplyExactDecimals,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  type ExactDecimal,
} from '../../../capitalFoundation/contracts/decimal.js';
import type { ExactFilterDecimal } from './types.js';

const RAW_DECIMAL = /^\d+(?:\.\d+)?$/;
const MAXIMUM_UNSIGNED_DECIMAL_CHARACTERS = 97;

function exact(value: string): ExactDecimal {
  return normalizeNonNegativeExactDecimal(value);
}

export function normalizeFilterDecimal(value: unknown, positive = false): ExactFilterDecimal {
  if (typeof value !== 'string' || value.length > MAXIMUM_UNSIGNED_DECIMAL_CHARACTERS
    || !RAW_DECIMAL.test(value)) {
    throw new TypeError('filter decimal must be an exact unsigned plain-decimal string');
  }
  const canonical = normalizeNonNegativeExactDecimal(value);
  if (positive && compareExactDecimals(canonical, exact('0')) <= 0) {
    throw new RangeError('filter decimal must be positive');
  }
  return Object.freeze({ raw: value, canonical });
}

export function normalizeSizingDecimal(value: unknown, positive = false): string {
  if (typeof value !== 'string' || value.length > MAXIMUM_UNSIGNED_DECIMAL_CHARACTERS
    || !RAW_DECIMAL.test(value)) {
    throw new TypeError('sizing decimal must be an exact unsigned plain-decimal string');
  }
  const normalized = normalizeNonNegativeExactDecimal(value);
  if (positive && compareExactDecimals(normalized, exact('0')) <= 0) {
    throw new RangeError('sizing decimal must be positive');
  }
  return normalized;
}

export function compareDecimal(left: string, right: string): -1 | 0 | 1 {
  return compareExactDecimals(exact(left), exact(right));
}

export function multiplyDecimal(left: string, right: string): string {
  return normalizeNonNegativeExactDecimal(multiplyExactDecimals(exact(left), exact(right)));
}

export function minimumDecimal(left: string, right: string): string {
  return normalizeNonNegativeExactDecimal(minimumExactDecimal(exact(left), exact(right)));
}

export function decimalScale(value: string): number {
  const normalized = normalizeNonNegativeExactDecimal(value);
  return normalized.includes('.') ? normalized.length - normalized.indexOf('.') - 1 : 0;
}

export function floorToGrid(value: string, step: string, origin: string): string | null {
  const candidate = exact(value);
  const quantum = exact(step);
  const base = exact(origin);
  if (compareExactDecimals(quantum, exact('0')) <= 0 || compareExactDecimals(candidate, base) < 0) return null;
  const delta = normalizeNonNegativeExactDecimal(subtractExactDecimals(candidate, base));
  const count = normalizeNonNegativeExactDecimal(divideExactDecimals(delta, quantum, 0));
  return normalizeNonNegativeExactDecimal(addExactDecimals(
    base,
    multiplyExactDecimals(count, quantum),
  ));
}

export function isGridAligned(value: string, step: string, origin: string): boolean {
  const aligned = floorToGrid(value, step, origin);
  return aligned !== null && compareDecimal(aligned, value) === 0;
}

export function divideDecimalDown(dividend: string, divisor: string): string {
  return normalizeNonNegativeExactDecimal(divideExactDecimals(exact(dividend), exact(divisor), 24));
}
