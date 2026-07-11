/**
 * Capital-local exact decimal value object.
 *
 * Public values are canonical base-10 strings. Arithmetic uses bigint
 * coefficients internally and never crosses an IEEE-754 financial boundary.
 * The shape follows the repository's USD-M decimal convention while adding
 * the signed add/subtract/divide operations this domain requires.
 */

declare const EXACT_DECIMAL: unique symbol;
declare const NON_NEGATIVE_DECIMAL: unique symbol;

export type ExactDecimal = string & { readonly [EXACT_DECIMAL]: 'ExactDecimal' };
export type NonNegativeDecimal = ExactDecimal & {
  readonly [NON_NEGATIVE_DECIMAL]: 'NonNegativeDecimal';
};

export const MAX_EXACT_DECIMAL_DIGITS = 96;
export const MAX_DIVISION_SCALE = 24;

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

interface ParsedDecimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

function powerOfTen(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > MAX_EXACT_DECIMAL_DIGITS) {
    throw new RangeError('decimal exponent is outside the supported bound');
  }
  return 10n ** BigInt(exponent);
}

function parseCanonical(value: ExactDecimal): ParsedDecimal {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const coefficient = BigInt(`${whole}${fraction}`);
  return Object.freeze({ coefficient: negative ? -coefficient : coefficient, scale: fraction.length });
}

function formatDecimal(coefficient: bigint, scale: number): ExactDecimal {
  if (coefficient === 0n) return '0' as ExactDecimal;
  const negative = coefficient < 0n;
  let digits = (negative ? -coefficient : coefficient).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    const split = digits.length - scale;
    digits = `${digits.slice(0, split)}.${digits.slice(split)}`;
  }
  return normalizeExactDecimal(`${negative ? '-' : ''}${digits}`);
}

export function normalizeExactDecimal(input: unknown): ExactDecimal {
  if (typeof input !== 'string' || input.length === 0 || input.trim() !== input) {
    throw new TypeError('exact decimal must be a non-empty, unpadded string');
  }
  const match = DECIMAL_PATTERN.exec(input);
  if (match === null) {
    throw new TypeError('exact decimal must use plain base-10 notation without exponent syntax');
  }
  const digitCount = match[2].length + (match[3]?.length ?? 0);
  if (digitCount > MAX_EXACT_DECIMAL_DIGITS) {
    throw new RangeError(`exact decimal exceeds ${MAX_EXACT_DECIMAL_DIGITS} digits`);
  }
  const whole = match[2].replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const unsigned = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  if (/^0(?:\.0*)?$/.test(unsigned)) return '0' as ExactDecimal;
  return `${match[1] === '-' ? '-' : ''}${unsigned}` as ExactDecimal;
}

export function normalizeNonNegativeExactDecimal(input: unknown): NonNegativeDecimal {
  const normalized = normalizeExactDecimal(input);
  if (normalized.startsWith('-')) throw new RangeError('exact decimal must be non-negative');
  return normalized as NonNegativeDecimal;
}

export function isExactDecimal(input: unknown): input is ExactDecimal {
  try {
    normalizeExactDecimal(input);
    return true;
  } catch {
    return false;
  }
}

export function compareExactDecimals(left: ExactDecimal, right: ExactDecimal): -1 | 0 | 1 {
  const a = parseCanonical(normalizeExactDecimal(left));
  const b = parseCanonical(normalizeExactDecimal(right));
  const scale = Math.max(a.scale, b.scale);
  const av = a.coefficient * powerOfTen(scale - a.scale);
  const bv = b.coefficient * powerOfTen(scale - b.scale);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function align(left: ExactDecimal, right: ExactDecimal): readonly [bigint, bigint, number] {
  const a = parseCanonical(normalizeExactDecimal(left));
  const b = parseCanonical(normalizeExactDecimal(right));
  const scale = Math.max(a.scale, b.scale);
  return Object.freeze([
    a.coefficient * powerOfTen(scale - a.scale),
    b.coefficient * powerOfTen(scale - b.scale),
    scale,
  ] as const);
}

export function addExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const [a, b, scale] = align(left, right);
  return formatDecimal(a + b, scale);
}

export function subtractExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const [a, b, scale] = align(left, right);
  return formatDecimal(a - b, scale);
}

export function multiplyExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const a = parseCanonical(normalizeExactDecimal(left));
  const b = parseCanonical(normalizeExactDecimal(right));
  return formatDecimal(a.coefficient * b.coefficient, a.scale + b.scale);
}

/**
 * Divide with an explicit output scale, truncating toward zero. Capital and
 * reservation callers use non-negative inputs, making this a conservative
 * round-down rule. No implicit rounding mode exists.
 */
export function divideExactDecimals(
  dividend: ExactDecimal,
  divisor: ExactDecimal,
  outputScale: number,
): ExactDecimal {
  if (!Number.isSafeInteger(outputScale) || outputScale < 0 || outputScale > MAX_DIVISION_SCALE) {
    throw new RangeError(`outputScale must be an integer in [0, ${MAX_DIVISION_SCALE}]`);
  }
  const a = parseCanonical(normalizeExactDecimal(dividend));
  const b = parseCanonical(normalizeExactDecimal(divisor));
  if (b.coefficient === 0n) throw new RangeError('exact decimal division by zero');
  const exponent = b.scale + outputScale - a.scale;
  const numerator = exponent >= 0 ? a.coefficient * powerOfTen(exponent) : a.coefficient;
  const denominator = exponent >= 0 ? b.coefficient : b.coefficient * powerOfTen(-exponent);
  return formatDecimal(numerator / denominator, outputScale);
}

export function negateExactDecimal(value: ExactDecimal): ExactDecimal {
  const normalized = normalizeExactDecimal(value);
  return normalized === '0'
    ? normalized
    : normalizeExactDecimal(normalized.startsWith('-') ? normalized.slice(1) : `-${normalized}`);
}

export function absoluteExactDecimal(value: ExactDecimal): NonNegativeDecimal {
  const normalized = normalizeExactDecimal(value);
  return (normalized.startsWith('-') ? normalized.slice(1) : normalized) as NonNegativeDecimal;
}

export function minimumExactDecimal(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return compareExactDecimals(left, right) <= 0 ? normalizeExactDecimal(left) : normalizeExactDecimal(right);
}

export function maximumExactDecimal(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return compareExactDecimals(left, right) >= 0 ? normalizeExactDecimal(left) : normalizeExactDecimal(right);
}

export function sumExactDecimals(values: readonly ExactDecimal[]): ExactDecimal {
  return values.reduce<ExactDecimal>((total, value) => addExactDecimals(total, value), '0' as ExactDecimal);
}

export function isExactZero(value: ExactDecimal): boolean {
  return normalizeExactDecimal(value) === '0';
}

export function isExactPositive(value: ExactDecimal): boolean {
  return compareExactDecimals(normalizeExactDecimal(value), '0' as ExactDecimal) > 0;
}

export function isExactNegative(value: ExactDecimal): boolean {
  return compareExactDecimals(normalizeExactDecimal(value), '0' as ExactDecimal) < 0;
}
