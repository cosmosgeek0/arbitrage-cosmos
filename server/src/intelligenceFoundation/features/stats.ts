export function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function safeAdd(left: number, right: number): number | null {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  const value = left + right;
  return Number.isFinite(value) ? value : null;
}

export function safeMultiply(left: number, right: number): number | null {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  const value = left * right;
  return Number.isFinite(value) ? value : null;
}

export function sum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    const next = safeAdd(total, value);
    if (next === null) return null;
    total = next;
  }
  return total;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = sum(values);
  return total === null ? null : total / values.length;
}

export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(0, Math.min(1, q)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return Number.isFinite(sorted[lower]) ? sorted[lower] : null;
  const fraction = position - lower;
  const interpolated = sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
  return Number.isFinite(interpolated) ? interpolated : null;
}

export function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

export function standardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values);
  if (average === null) return null;
  const squared = values.map((value) => (value - average) ** 2);
  const total = sum(squared);
  if (total === null) return null;
  const result = Math.sqrt(total / values.length);
  return Number.isFinite(result) ? result : null;
}

export function robustValues(values: readonly number[]): number[] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 4) return finite;
  const center = median(finite) as number;
  const deviations = finite.map((value) => Math.abs(value - center));
  const mad = median(deviations) as number;
  if (mad > 0) {
    const limit = mad * 12;
    return finite.map((value) => Math.max(center - limit, Math.min(center + limit, value)));
  }
  const q1 = quantile(finite, 0.25) as number;
  const q3 = quantile(finite, 0.75) as number;
  const iqr = q3 - q1;
  if (iqr <= 0) return finite;
  return finite.map((value) => Math.max(q1 - 6 * iqr, Math.min(q3 + 6 * iqr, value)));
}

export function percentChange(first: number | null, last: number | null): number | null {
  if (first === null || last === null || !Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  const result = ((last - first) / first) * 100;
  return Number.isFinite(result) ? result : null;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
