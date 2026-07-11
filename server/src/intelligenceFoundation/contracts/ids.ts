import { createHash } from 'node:crypto';
import type { JsonValue } from './types.js';

function asJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => asJsonValue(entry, `${path}[${index}]`));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) throw new TypeError(`undefined is not valid contract data at ${path}.${key}`);
      output[key] = asJsonValue(entry, `${path}.${key}`);
    }
    return output;
  }
  throw new TypeError(`unsupported contract value at ${path}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(asJsonValue(value, '$'));
}

export function stableId(namespace: string, naturalIdentity: unknown): string {
  if (!/^[a-z][a-z0-9._-]{1,63}$/i.test(namespace)) throw new TypeError('invalid stable-id namespace');
  const digest = createHash('sha256')
    .update(namespace)
    .update('\0')
    .update(canonicalJson(naturalIdentity))
    .digest('hex')
    .slice(0, 24);
  return `${namespace}:${digest}`;
}

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
