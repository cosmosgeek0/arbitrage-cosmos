export function nearestRankPercentile(sortedValues: readonly number[], quantile: number): number | null {
  if (!Number.isFinite(quantile) || quantile <= 0 || quantile > 1) {
    throw new RangeError('quantile must be finite in (0, 1]');
  }
  if (sortedValues.length === 0) return null;
  for (let index = 0; index < sortedValues.length; index += 1) {
    const value = sortedValues[index];
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('percentile values must be non-negative safe integers');
    if (index > 0 && value < (sortedValues[index - 1] as number)) throw new TypeError('percentile values must be sorted ascending');
  }
  return sortedValues[Math.max(0, Math.ceil(sortedValues.length * quantile) - 1)] ?? null;
}
