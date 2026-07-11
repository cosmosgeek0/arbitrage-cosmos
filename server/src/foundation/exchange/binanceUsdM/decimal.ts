/** Exact, bounded decimal-string arithmetic. No IEEE-754 conversion. */

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;
const MAX_DECIMAL_DIGITS = 80;

interface ParsedDecimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

function parseNormalized(value: string): ParsedDecimal {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ''] = unsigned.split('.');
  const digits = BigInt(`${whole}${fraction}`);
  return { coefficient: negative ? -digits : digits, scale: fraction.length };
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function format(coefficient: bigint, scale: number): string {
  if (coefficient === 0n) return '0';
  const negative = coefficient < 0n;
  let digits = (negative ? -coefficient : coefficient).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    const split = digits.length - scale;
    digits = `${digits.slice(0, split)}.${digits.slice(split)}`;
  }
  return `${negative ? '-' : ''}${digits}`;
}

/**
 * Canonical form: no plus sign, no redundant leading/trailing zeroes, no
 * exponent notation, and every mathematical zero is `0`.
 */
export function normalizeDecimalString(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.trim() !== input) {
    throw new TypeError('decimal must be a non-empty, unpadded string');
  }
  const match = DECIMAL_PATTERN.exec(input);
  if (match === null) {
    throw new TypeError('decimal must use plain base-10 notation without exponent syntax');
  }
  const digitCount = match[2].length + (match[3]?.length ?? 0);
  if (digitCount > MAX_DECIMAL_DIGITS) {
    throw new TypeError(`decimal exceeds ${MAX_DECIMAL_DIGITS} digits`);
  }
  const whole = match[2].replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const unsigned = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  if (/^0(?:\.0*)?$/.test(unsigned)) return '0';
  return `${match[1] === '-' ? '-' : ''}${unsigned}`;
}

export function isDecimalString(input: unknown): input is string {
  try {
    normalizeDecimalString(input);
    return true;
  } catch {
    return false;
  }
}

export function compareDecimalStrings(left: string, right: string): -1 | 0 | 1 {
  const a = parseNormalized(normalizeDecimalString(left));
  const b = parseNormalized(normalizeDecimalString(right));
  const scale = Math.max(a.scale, b.scale);
  const av = a.coefficient * pow10(scale - a.scale);
  const bv = b.coefficient * pow10(scale - b.scale);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

export function isPositiveDecimal(value: string): boolean {
  return compareDecimalStrings(value, '0') > 0;
}

/** True when value is an exact integer multiple of positive increment. */
export function isDecimalMultiple(value: string, increment: string): boolean {
  const a = parseNormalized(normalizeDecimalString(value));
  const step = parseNormalized(normalizeDecimalString(increment));
  if (step.coefficient <= 0n) throw new TypeError('increment must be greater than zero');
  const scale = Math.max(a.scale, step.scale);
  const av = a.coefficient * pow10(scale - a.scale);
  const sv = step.coefficient * pow10(scale - step.scale);
  return av % sv === 0n;
}

/** True when (value - origin) is an exact multiple of positive increment. */
export function isDecimalOffsetMultiple(value: string, origin: string, increment: string): boolean {
  const a = parseNormalized(normalizeDecimalString(value));
  const base = parseNormalized(normalizeDecimalString(origin));
  const step = parseNormalized(normalizeDecimalString(increment));
  if (step.coefficient <= 0n) throw new TypeError('increment must be greater than zero');
  const scale = Math.max(a.scale, base.scale, step.scale);
  const av = a.coefficient * pow10(scale - a.scale);
  const bv = base.coefficient * pow10(scale - base.scale);
  const sv = step.coefficient * pow10(scale - step.scale);
  return (av - bv) % sv === 0n;
}

export function multiplyDecimalStrings(left: string, right: string): string {
  const a = parseNormalized(normalizeDecimalString(left));
  const b = parseNormalized(normalizeDecimalString(right));
  return normalizeDecimalString(format(a.coefficient * b.coefficient, a.scale + b.scale));
}
