interface DecimalParts {
  readonly coefficient: bigint;
  readonly scale: number;
}

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u;
const MAX_DECIMAL_LENGTH = 256;

function parts(value: unknown, label: string): DecimalParts {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_DECIMAL_LENGTH || !DECIMAL.test(value)) {
    throw new TypeError(`${label} must be a canonical non-negative decimal`);
  }
  const [whole, fraction = ''] = value.split('.');
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function power10(value: number): bigint {
  return 10n ** BigInt(value);
}

function canonical(coefficient: bigint, scale: number): string {
  if (coefficient < 0n) throw new RangeError('decimal result must be non-negative');
  if (coefficient === 0n) return '0';
  let digits = coefficient.toString();
  if (scale === 0) {
    if (digits.length > MAX_DECIMAL_LENGTH) throw new RangeError('decimal result is overbound');
    return digits;
  }
  digits = digits.padStart(scale + 1, '0');
  let result = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  result = result.replace(/0+$/u, '').replace(/\.$/u, '');
  if (result.length > MAX_DECIMAL_LENGTH) throw new RangeError('decimal result is overbound');
  return result;
}

function align(left: DecimalParts, right: DecimalParts): readonly [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * power10(scale - left.scale),
    right.coefficient * power10(scale - right.scale),
    scale,
  ];
}

export function volumeDecimal(value: unknown, label = 'volume decimal'): string {
  const parsed = parts(value, label);
  const normalized = canonical(parsed.coefficient, parsed.scale);
  if (normalized !== value) throw new TypeError(`${label} must already be canonical`);
  return normalized;
}

export function positiveVolumeDecimal(value: unknown, label = 'volume decimal'): string {
  const normalized = volumeDecimal(value, label);
  if (normalized === '0') throw new RangeError(`${label} must be positive`);
  return normalized;
}

export function compareVolumeDecimals(leftValue: string, rightValue: string): -1 | 0 | 1 {
  const [left, right] = align(parts(leftValue, 'left decimal'), parts(rightValue, 'right decimal'));
  return left < right ? -1 : left > right ? 1 : 0;
}

export function addVolumeDecimals(leftValue: string, rightValue: string): string {
  const [left, right, scale] = align(parts(leftValue, 'left decimal'), parts(rightValue, 'right decimal'));
  return canonical(left + right, scale);
}

export function subtractVolumeDecimals(leftValue: string, rightValue: string): string {
  const [left, right, scale] = align(parts(leftValue, 'left decimal'), parts(rightValue, 'right decimal'));
  if (left < right) throw new RangeError('volume decimal subtraction would be negative');
  return canonical(left - right, scale);
}

export function multiplyVolumeDecimals(leftValue: string, rightValue: string): string {
  const left = parts(leftValue, 'left decimal');
  const right = parts(rightValue, 'right decimal');
  return canonical(left.coefficient * right.coefficient, left.scale + right.scale);
}

export function divideVolumeDecimals(leftValue: string, rightValue: string, scale = 24): string {
  const left = parts(leftValue, 'left decimal');
  const right = parts(rightValue, 'right decimal');
  if (right.coefficient === 0n) throw new RangeError('volume decimal division by zero');
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 36) throw new RangeError('volume decimal division scale is invalid');
  const numerator = left.coefficient * power10(right.scale + scale);
  const denominator = right.coefficient * power10(left.scale);
  return canonical(numerator / denominator, scale);
}

export function multiplyVolumePpm(value: string, ppm: number): string {
  if (!Number.isSafeInteger(ppm) || ppm < 0 || ppm > 1_000_000) throw new RangeError('ppm must be in [0, 1000000]');
  const parsed = parts(value, 'ppm decimal');
  // PPM is an exact six-decimal multiplier. Retaining those six places avoids
  // silently rounding a small base quantity down to zero before L04 can apply
  // the venue quantity filter.
  return canonical(parsed.coefficient * BigInt(ppm), parsed.scale + 6);
}

export function sumVolumeDecimals(values: readonly string[]): string {
  return values.reduce((total, value) => addVolumeDecimals(total, value), '0');
}

function compareScaledProducts(
  leftPrice: string,
  leftMultiplier: number,
  rightPrice: string,
  rightMultiplier: number,
): -1 | 0 | 1 {
  const left = parts(leftPrice, 'left price');
  const right = parts(rightPrice, 'right price');
  const scale = Math.max(left.scale, right.scale);
  const leftScaled = left.coefficient * power10(scale - left.scale) * BigInt(leftMultiplier);
  const rightScaled = right.coefficient * power10(scale - right.scale) * BigInt(rightMultiplier);
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

export function lossStopReached(
  direction: 'LONG' | 'SHORT',
  entryAveragePrice: string,
  currentPrice: string,
  maximumLossBps: number,
): boolean {
  if (!Number.isSafeInteger(maximumLossBps) || maximumLossBps <= 0 || maximumLossBps >= 10_000) {
    throw new RangeError('maximum loss bps is invalid');
  }
  return direction === 'LONG'
    ? compareScaledProducts(currentPrice, 10_000, entryAveragePrice, 10_000 - maximumLossBps) <= 0
    : compareScaledProducts(currentPrice, 10_000, entryAveragePrice, 10_000 + maximumLossBps) >= 0;
}

export function trailingStopReached(
  direction: 'LONG' | 'SHORT',
  entryAveragePrice: string,
  favorableExtremePrice: string,
  currentPrice: string,
  activationBps: number,
  distanceBps: number,
): boolean {
  if (![activationBps, distanceBps].every((value) => Number.isSafeInteger(value) && value > 0 && value < 10_000)) {
    throw new RangeError('trailing bps is invalid');
  }
  const active = direction === 'LONG'
    ? compareScaledProducts(favorableExtremePrice, 10_000, entryAveragePrice, 10_000 + activationBps) >= 0
    : compareScaledProducts(favorableExtremePrice, 10_000, entryAveragePrice, 10_000 - activationBps) <= 0;
  if (!active) return false;
  return direction === 'LONG'
    ? compareScaledProducts(currentPrice, 10_000, favorableExtremePrice, 10_000 - distanceBps) <= 0
    : compareScaledProducts(currentPrice, 10_000, favorableExtremePrice, 10_000 + distanceBps) >= 0;
}

export function favorableExtreme(
  direction: 'LONG' | 'SHORT',
  prior: string | null,
  current: string,
): string {
  positiveVolumeDecimal(current, 'current price');
  if (prior === null) return current;
  positiveVolumeDecimal(prior, 'prior favorable extreme');
  const comparison = compareVolumeDecimals(current, prior);
  return direction === 'LONG'
    ? comparison > 0 ? current : prior
    : comparison < 0 ? current : prior;
}
