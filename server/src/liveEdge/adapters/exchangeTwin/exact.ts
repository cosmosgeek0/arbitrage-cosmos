import {
  addExactDecimals,
  compareExactDecimals,
  divideExactDecimals,
  minimumExactDecimal,
  multiplyExactDecimals,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  type ExactDecimal,
  type NonNegativeDecimal,
} from '../../../capitalFoundation/contracts/decimal.js';

export function twinDecimal(value: unknown, label = 'twin decimal'): NonNegativeDecimal {
  try {
    return normalizeNonNegativeExactDecimal(value);
  } catch {
    throw new TypeError(`${label} must be an exact non-negative plain-decimal string`);
  }
}

export function twinPositiveDecimal(value: unknown, label = 'twin decimal'): NonNegativeDecimal {
  const normalized = twinDecimal(value, label);
  if (normalized === '0') throw new RangeError(`${label} must be positive`);
  return normalized;
}

export function addTwinDecimals(left: string, right: string): string {
  return addExactDecimals(twinDecimal(left), twinDecimal(right));
}

export function subtractTwinDecimals(left: string, right: string): string {
  const result = subtractExactDecimals(twinDecimal(left), twinDecimal(right));
  if (result.startsWith('-')) throw new RangeError('twin decimal subtraction would become negative');
  return result;
}

export function multiplyTwinDecimals(left: string, right: string): string {
  return multiplyExactDecimals(twinDecimal(left), twinDecimal(right));
}

export function minimumTwinDecimal(left: string, right: string): string {
  return minimumExactDecimal(twinDecimal(left), twinDecimal(right));
}

export function compareTwinDecimals(left: string, right: string): -1 | 0 | 1 {
  return compareExactDecimals(twinDecimal(left), twinDecimal(right));
}

export function divideTwinDecimals(left: string, right: string, scale = 24): string {
  return divideExactDecimals(twinDecimal(left), twinPositiveDecimal(right), scale);
}

export function signedTwinResidual(recorded: string, predicted: string): string {
  return normalizeExactDecimal(
    subtractExactDecimals(twinDecimal(recorded), twinDecimal(predicted)),
  ) as ExactDecimal;
}
