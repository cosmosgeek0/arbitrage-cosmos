import {
  addExactDecimals,
  compareExactDecimals,
  multiplyExactDecimals,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  type ExactDecimal,
  type NonNegativeDecimal,
} from '../../../capitalFoundation/contracts/decimal.js';

const MAX_POLICY_DECIMAL_DIGITS = 72;
const MAX_PPM = 1_000_000;

function digitCount(value: string): number {
  return value.replace(/^[+-]/u, '').replace('.', '').length;
}

export function policyDecimal(value: unknown, label = 'policy decimal'): NonNegativeDecimal {
  try {
    const normalized = normalizeNonNegativeExactDecimal(value);
    if (digitCount(normalized) > MAX_POLICY_DECIMAL_DIGITS) throw new RangeError('overbound');
    return normalized;
  } catch {
    throw new TypeError(`${label} must be an exact non-negative plain-decimal string with at most ${MAX_POLICY_DECIMAL_DIGITS} digits`);
  }
}

export function signedPolicyDecimal(value: unknown, label = 'policy decimal'): ExactDecimal {
  try {
    const normalized = normalizeExactDecimal(value);
    if (digitCount(normalized) > MAX_POLICY_DECIMAL_DIGITS) throw new RangeError('overbound');
    return normalized;
  } catch {
    throw new TypeError(`${label} must be an exact signed plain-decimal string with at most ${MAX_POLICY_DECIMAL_DIGITS} digits`);
  }
}

export function comparePolicyDecimals(left: string, right: string): -1 | 0 | 1 {
  return compareExactDecimals(signedPolicyDecimal(left), signedPolicyDecimal(right));
}

export function addPolicyDecimals(left: string, right: string): string {
  return addExactDecimals(signedPolicyDecimal(left), signedPolicyDecimal(right));
}

export function weightedPolicyDecimal(value: string, probabilityPpm: number): string {
  requireBoundedInteger(probabilityPpm, 0, 'probabilityPpm');
  return multiplyExactDecimals(signedPolicyDecimal(value), signedPolicyDecimal(String(probabilityPpm)));
}

export function multiplyPolicyDecimals(left: string, right: string): string {
  return multiplyExactDecimals(signedPolicyDecimal(left), signedPolicyDecimal(right));
}

export function compareRationals(
  leftNumerator: string,
  leftDenominator: number,
  rightNumerator: string,
  rightDenominator: number,
): -1 | 0 | 1 {
  requireBoundedInteger(leftDenominator, 1, 'left denominator');
  requireBoundedInteger(rightDenominator, 1, 'right denominator');
  const left = multiplyExactDecimals(signedPolicyDecimal(leftNumerator), signedPolicyDecimal(String(rightDenominator)));
  const right = multiplyExactDecimals(signedPolicyDecimal(rightNumerator), signedPolicyDecimal(String(leftDenominator)));
  return compareExactDecimals(left, right);
}

export function rationalWithinLimit(numerator: string, denominator: number, limit: string): boolean {
  requireBoundedInteger(denominator, 1, 'denominator');
  return comparePolicyDecimals(
    numerator,
    multiplyExactDecimals(policyDecimal(limit), signedPolicyDecimal(String(denominator))),
  ) <= 0;
}

function requireBoundedInteger(value: number, minimum: 0 | 1, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_PPM) {
    throw new TypeError(`${label} must be a safe integer in [${minimum}, ${MAX_PPM}]`);
  }
  return value;
}
