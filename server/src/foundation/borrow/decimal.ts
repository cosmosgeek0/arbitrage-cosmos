/**
 * Exact, bounded, non-negative decimal handling for venue evidence.
 * Scientific notation, signs, whitespace, NaN, and Infinity are rejected.
 */
const DECIMAL = /^(?:0|[0-9]+)(?:\.[0-9]+)?$/;
const MAX_DECIMAL_LENGTH = 120;

export function normalizeNonNegativeDecimal(value: string, fieldName = 'decimal'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_DECIMAL_LENGTH || !DECIMAL.test(value)) {
    throw new TypeError(`${fieldName} must be a non-negative plain decimal string`);
  }
  const [rawWhole, rawFraction = ''] = value.split('.');
  const whole = rawWhole.replace(/^0+(?=\d)/, '');
  const fraction = rawFraction.replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

export function compareNonNegativeDecimals(left: string, right: string): -1 | 0 | 1 {
  const a = normalizeNonNegativeDecimal(left, 'left');
  const b = normalizeNonNegativeDecimal(right, 'right');
  const [aWhole, aFraction = ''] = a.split('.');
  const [bWhole, bFraction = ''] = b.split('.');
  if (aWhole.length !== bWhole.length) return aWhole.length < bWhole.length ? -1 : 1;
  if (aWhole !== bWhole) return aWhole < bWhole ? -1 : 1;
  const width = Math.max(aFraction.length, bFraction.length);
  const aPadded = aFraction.padEnd(width, '0');
  const bPadded = bFraction.padEnd(width, '0');
  return aPadded === bPadded ? 0 : aPadded < bPadded ? -1 : 1;
}

export function isExactZero(value: string): boolean {
  return normalizeNonNegativeDecimal(value) === '0';
}
