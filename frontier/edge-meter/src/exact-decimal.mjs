const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/;
const MAX_INTEGER_DIGITS = 60;

function parts(value) {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) {
    throw Object.assign(new TypeError('exact decimal must be a plain decimal string with at most 18 fractional digits'), {
      code: 'EXACT_DECIMAL_INVALID',
    });
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ''] = unsigned.split('.');
  if (integer.length > MAX_INTEGER_DIGITS) {
    throw Object.assign(new RangeError('exact decimal exceeds the bounded integer precision'), {
      code: 'EXACT_DECIMAL_PRECISION_EXCEEDED',
    });
  }
  const trimmedFraction = fraction.replace(/0+$/, '');
  const magnitudeZero = /^0+$/.test(integer) && (trimmedFraction.length === 0 || /^0+$/.test(trimmedFraction));
  const normalized = `${negative && !magnitudeZero ? '-' : ''}${integer}${trimmedFraction.length > 0 ? `.${trimmedFraction}` : ''}`;
  if (normalized !== value) {
    throw Object.assign(new TypeError('exact decimal must be canonical (no negative zero or trailing fractional zeros)'), {
      code: 'EXACT_DECIMAL_NOT_CANONICAL',
    });
  }
  const digits = `${integer}${trimmedFraction}`;
  return {
    coefficient: BigInt(`${negative ? '-' : ''}${digits}`),
    scale: trimmedFraction.length,
  };
}

function pow10(exponent) {
  return 10n ** BigInt(exponent);
}

function format(coefficient, scale) {
  if (coefficient === 0n) return '0';
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
  const integer = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? '' : digits.slice(-scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer}${fraction.length > 0 ? `.${fraction}` : ''}`;
}

function aligned(left, right) {
  const a = parts(left);
  const b = parts(right);
  const scale = Math.max(a.scale, b.scale);
  return {
    left: a.coefficient * pow10(scale - a.scale),
    right: b.coefficient * pow10(scale - b.scale),
    scale,
  };
}

export function assertExactDecimal(value) {
  parts(value);
  return value;
}

export function isExactDecimal(value) {
  try {
    parts(value);
    return true;
  } catch {
    return false;
  }
}

export function addExactDecimals(left, right) {
  const values = aligned(left, right);
  return format(values.left + values.right, values.scale);
}

export function subtractExactDecimals(left, right) {
  const values = aligned(left, right);
  return format(values.left - values.right, values.scale);
}

export function compareExactDecimals(left, right) {
  const values = aligned(left, right);
  return values.left < values.right ? -1 : values.left > values.right ? 1 : 0;
}

export function sumExactDecimals(values) {
  if (!Array.isArray(values)) throw new TypeError('exact decimal sum requires an array');
  return values.reduce((total, value) => addExactDecimals(total, value), '0');
}

export function exactDecimalInRange(value, range) {
  assertExactDecimal(value);
  assertExactDecimal(range.low);
  assertExactDecimal(range.high);
  return compareExactDecimals(range.low, range.high) <= 0
    && compareExactDecimals(value, range.low) >= 0
    && compareExactDecimals(value, range.high) <= 0;
}
