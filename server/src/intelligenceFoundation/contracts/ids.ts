import { createHash } from 'node:crypto';
import type { JsonValue } from './types.js';

const MAX_CANONICAL_DEPTH = 64;
const MAX_CANONICAL_NODES = 100_000;
const MAX_COLLECTION_SIZE = 50_000;

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function asJsonValue(value: unknown, path: string, seen: Set<object>, depth: number, budget: { nodes: number }): JsonValue {
  if (depth > MAX_CANONICAL_DEPTH) throw new TypeError(`contract value exceeds maximum depth at ${path}`);
  budget.nodes += 1;
  if (budget.nodes > MAX_CANONICAL_NODES) throw new TypeError(`contract value exceeds maximum size at ${path}`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_SIZE) throw new TypeError(`contract array exceeds maximum size at ${path}`);
    if (seen.has(value)) throw new TypeError(`cyclic contract value at ${path}`);
    seen.add(value);
    const output = value.map((entry, index) => asJsonValue(entry, `${path}[${index}]`, seen, depth + 1, budget));
    seen.delete(value);
    return output;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`non-plain contract object at ${path}`);
    if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`symbol keys are not valid contract data at ${path}`);
    if (seen.has(value)) throw new TypeError(`cyclic contract value at ${path}`);
    seen.add(value);
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(codePointCompare);
    if (keys.length > MAX_COLLECTION_SIZE) throw new TypeError(`contract object exceeds maximum size at ${path}`);
    const output: Record<string, JsonValue> = {};
    for (const key of keys) {
      const entry = record[key];
      if (entry === undefined) throw new TypeError(`undefined is not valid contract data at ${path}.${key}`);
      output[key] = asJsonValue(entry, `${path}.${key}`, seen, depth + 1, budget);
    }
    seen.delete(value);
    return output;
  }
  throw new TypeError(`unsupported contract value at ${path}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(asJsonValue(value, '$', new Set<object>(), 0, { nodes: 0 }));
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
  return [...new Set(values)].sort(codePointCompare);
}

/** Canonicalizes only caller-declared set-like string arrays. */
export function stableSetId(
  namespace: string,
  naturalIdentity: Readonly<Record<string, unknown>>,
  setFields: readonly string[],
): string {
  const normalized: Record<string, unknown> = { ...naturalIdentity };
  for (const field of sortedUnique(setFields)) {
    const value = normalized[field];
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
      throw new TypeError(`stable set field ${field} must be a string array`);
    }
    normalized[field] = sortedUnique(value);
  }
  return stableId(namespace, normalized);
}
