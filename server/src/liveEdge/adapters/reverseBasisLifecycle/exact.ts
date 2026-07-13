const MAX_DECIMAL_TEXT = 256;
const CANONICAL_NON_NEGATIVE = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u;

interface ParsedDecimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

function parseDecimal(value: string): ParsedDecimal {
  const [integer, fraction = ''] = value.split('.');
  return Object.freeze({
    coefficient: BigInt(`${integer}${fraction}`),
    scale: fraction.length,
  });
}

function align(
  left: ParsedDecimal,
  right: ParsedDecimal,
): readonly [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  const leftCoefficient = left.coefficient * (10n ** BigInt(scale - left.scale));
  const rightCoefficient = right.coefficient * (10n ** BigInt(scale - right.scale));
  return Object.freeze([leftCoefficient, rightCoefficient, scale] as const);
}

function formatDecimal(coefficient: bigint, scale: number): string {
  if (coefficient < 0n) throw new TypeError('reverse-basis decimal result is negative');
  if (coefficient === 0n) return '0';
  let normalized = coefficient;
  let normalizedScale = scale;
  while (normalizedScale > 0 && normalized % 10n === 0n) {
    normalized /= 10n;
    normalizedScale -= 1;
  }
  const digits = normalized.toString().padStart(normalizedScale + 1, '0');
  return normalizedScale === 0
    ? digits
    : `${digits.slice(0, -normalizedScale)}.${digits.slice(-normalizedScale)}`;
}

export function reverseBasisDecimal(value: unknown, label = 'reverse-basis decimal'): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_DECIMAL_TEXT
    || !CANONICAL_NON_NEGATIVE.test(value)
  ) throw new TypeError(`${label} must be a canonical non-negative exact decimal`);
  return value;
}

export function addReverseBasisDecimals(left: string, right: string): string {
  const [leftCoefficient, rightCoefficient, scale] = align(
    parseDecimal(reverseBasisDecimal(left)),
    parseDecimal(reverseBasisDecimal(right)),
  );
  return formatDecimal(leftCoefficient + rightCoefficient, scale);
}

export function compareReverseBasisDecimals(left: string, right: string): -1 | 0 | 1 {
  const [leftCoefficient, rightCoefficient] = align(
    parseDecimal(reverseBasisDecimal(left)),
    parseDecimal(reverseBasisDecimal(right)),
  );
  return leftCoefficient < rightCoefficient ? -1 : leftCoefficient > rightCoefficient ? 1 : 0;
}

export function subtractReverseBasisFloorZero(left: string, right: string): string {
  const [leftCoefficient, rightCoefficient, scale] = align(
    parseDecimal(reverseBasisDecimal(left)),
    parseDecimal(reverseBasisDecimal(right)),
  );
  return leftCoefficient <= rightCoefficient
    ? '0'
    : formatDecimal(leftCoefficient - rightCoefficient, scale);
}

export function absoluteReverseBasisDifference(left: string, right: string): string {
  const [leftCoefficient, rightCoefficient, scale] = align(
    parseDecimal(reverseBasisDecimal(left)),
    parseDecimal(reverseBasisDecimal(right)),
  );
  const difference = leftCoefficient >= rightCoefficient
    ? leftCoefficient - rightCoefficient
    : rightCoefficient - leftCoefficient;
  return formatDecimal(difference, scale);
}

export function sumReverseBasisDecimals(values: readonly string[]): string {
  return values.reduce((total, value) => addReverseBasisDecimals(total, value), '0');
}
