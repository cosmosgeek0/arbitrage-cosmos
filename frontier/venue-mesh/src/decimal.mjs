import { boundedString } from './guards.mjs';
import { fail } from './errors.mjs';

export const FIXED_SCALE = 1_000_000_000_000n;
const DECIMAL_PATTERN = /^([+-]?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const MAX_ABS_MANTISSA = 10n ** 48n;

function checkedMantissa(value, field) {
  if (typeof value !== 'bigint' || value > MAX_ABS_MANTISSA || value < -MAX_ABS_MANTISSA) {
    fail('DECIMAL_RANGE_INVALID', `${field} exceeds the bounded fixed-point range`);
  }
  return value;
}

export function decimalToMantissa(value, field = 'decimal', { allowNegative = false } = {}) {
  boundedString(value, field, 128);
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) fail('DECIMAL_INVALID', `${field} must be a canonical finite decimal string`);
  const [, sign, integerPart, rawFraction = ''] = match;
  const discarded = rawFraction.slice(12);
  if (discarded.length > 0 && /[1-9]/.test(discarded)) {
    fail('DECIMAL_PRECISION_UNSUPPORTED', `${field} has non-zero precision beyond 12 decimal places`);
  }
  const fraction = rawFraction.slice(0, 12).padEnd(12, '0');
  let mantissa = (BigInt(integerPart) * FIXED_SCALE) + BigInt(fraction || '0');
  if (sign === '-') mantissa = -mantissa;
  if (!allowNegative && mantissa < 0n) fail('DECIMAL_NEGATIVE', `${field} cannot be negative`);
  return checkedMantissa(mantissa, field);
}

export function mantissaToDecimal(value) {
  checkedMantissa(value, 'mantissa');
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const integerPart = absolute / FIXED_SCALE;
  const fractionPart = absolute % FIXED_SCALE;
  let rendered = integerPart.toString();
  if (fractionPart !== 0n) {
    rendered += `.${fractionPart.toString().padStart(12, '0').replace(/0+$/, '')}`;
  }
  return negative ? `-${rendered}` : rendered;
}

export function roundHalfEven(numerator, denominator) {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint' || denominator <= 0n) {
    fail('RATIONAL_INVALID', 'roundHalfEven requires a bigint numerator and positive bigint denominator');
  }
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  let quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const doubled = remainder * 2n;
  if (doubled > denominator || (doubled === denominator && quotient % 2n !== 0n)) quotient += 1n;
  return negative ? -quotient : quotient;
}

export function multiplyMantissas(left, right, field = 'product') {
  return checkedMantissa(roundHalfEven(left * right, FIXED_SCALE), field);
}

export function divideMantissas(left, right, field = 'quotient') {
  if (right === 0n) fail('DECIMAL_DIVIDE_BY_ZERO', `${field} cannot divide by zero`);
  const sign = (left < 0n) !== (right < 0n) ? -1n : 1n;
  const absolute = roundHalfEven((left < 0n ? -left : left) * FIXED_SCALE, right < 0n ? -right : right);
  return checkedMantissa(sign * absolute, field);
}

export function ratioToBpsMantissa(numerator, denominator, field = 'basisPoints') {
  if (denominator <= 0n) fail('RATIO_DENOMINATOR_INVALID', `${field} denominator must be positive`);
  return checkedMantissa(roundHalfEven(numerator * 10_000n * FIXED_SCALE, denominator), field);
}

export function sumMantissas(values, field = 'sum') {
  if (!Array.isArray(values)) fail('DECIMAL_ARRAY_REQUIRED', `${field} values must be an array`);
  return checkedMantissa(values.reduce((total, value) => total + value, 0n), field);
}

export function fixedPointValue(mantissa) {
  checkedMantissa(mantissa, 'fixedPointValue.mantissa');
  return Object.freeze({ mantissa: mantissa.toString(), scale: FIXED_SCALE.toString() });
}
