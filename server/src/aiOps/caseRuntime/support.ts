import { createHash } from 'node:crypto';
import { canonicalJson } from '../../foundation/contracts/identity.js';
import { isValidUtcMillis } from '../../foundation/contracts/time.js';

export { canonicalJson };

export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function digestValue(value: unknown): string {
  return sha256(canonicalJson(value));
}

/** Lane-local identity only. It is not a canonical identity-owner contract. */
export function shadowSpeculativeId(namespace: string, naturalIdentity: unknown): string {
  if (!/^[a-z][a-z0-9-]{1,47}$/u.test(namespace)) throw new TypeError('invalid shadow identity namespace');
  return `${namespace}:${digestValue({ namespace, naturalIdentity }).slice(0, 24)}`;
}

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnitStrings);
}

/** Locale-free ordering keeps hashes and selections stable across ICU builds. */
export function compareCodeUnitStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const ALLOWED_SHADOW_INSTRUCTIONS = new Set([
  'COLLECT_EVIDENCE',
  'DIAGNOSE_ONLY',
  'DIAGNOSIS_RECORDED',
  'ESCALATE_TO_OWNER',
  'HANDOFF_TO_OWNER',
  'NO_ACTION',
  'QUARANTINE_CASE',
  'RETRY_DIAGNOSTIC',
  'REVIEW_DIAGNOSTIC',
  'RUN_SYNTHETIC_FALSIFICATION',
]);

export function assertShadowSafeInstruction(value: unknown, label: string): asserts value is string {
  assertIdentifier(value, label);
  if (!ALLOWED_SHADOW_INSTRUCTIONS.has(value)) throw new TypeError(`${label} violates the closed shadow no-money or no-acceptance vocabulary`);
}

export function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a bounded identifier`);
  }
}

export function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
}

export function assertUtc(value: unknown, label: string): asserts value is number {
  if (!isValidUtcMillis(value)) throw new TypeError(`${label} must be safe UTC milliseconds`);
}

export function assertSafeNonNegative(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

export function assertPositive(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

export function assertClosedKeys(value: object, allowed: readonly string[], label: string): void {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${label} cannot contain symbol keys`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const descriptor of Object.values(descriptors)) {
    if (!('value' in descriptor)) throw new TypeError(`${label} cannot contain accessors`);
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(descriptors)) {
    if (!allowedSet.has(key)) throw new TypeError(`${label} contains an unsupported field`);
  }
}

/**
 * Takes one callback-free snapshot of JSON-like caller data. Accessors, sparse
 * arrays, custom array methods/iterators, symbols, and exotic prototypes are
 * rejected before any owner port can be invoked.
 */
export function snapshotInertJson<T>(value: T, label: string, maximumNodes = 100_000): Readonly<T> {
  let nodes = 0;
  const visit = (entry: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > maximumNodes || depth > 64) throw new TypeError(`${label} exceeds inert snapshot bounds`);
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new TypeError(`${label} contains a non-finite number`);
      return entry;
    }
    if (typeof entry !== 'object') throw new TypeError(`${label} contains unsupported data`);
    if (Array.isArray(entry)) {
      if (Object.getPrototypeOf(entry) !== Array.prototype) throw new TypeError(`${label} contains an exotic array`);
      const ownKeys = Reflect.ownKeys(entry);
      if (ownKeys.some((key) => typeof key === 'symbol' || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key)))) {
        throw new TypeError(`${label} contains custom array fields`);
      }
      const output: unknown[] = [];
      for (let index = 0; index < entry.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(entry, String(index));
        if (!descriptor || !('value' in descriptor)) throw new TypeError(`${label} contains a sparse or accessor array element`);
        output.push(visit(descriptor.value, depth + 1));
      }
      return Object.freeze(output);
    }
    const prototype = Object.getPrototypeOf(entry);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} contains an exotic object`);
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(entry)) {
      if (typeof key !== 'string') throw new TypeError(`${label} contains a symbol field`);
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError(`${label} contains an accessor or hidden field`);
      Object.defineProperty(output, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(output);
  };
  return visit(value, 0) as Readonly<T>;
}

/** Keeps runtime-owned deeply frozen values reference-stable while retaining the same inert-data boundary. */
export function snapshotInertJsonPreservingDeepFreeze<T>(
  value: T,
  label: string,
  maximumNodes = 100_000,
): Readonly<T> {
  let nodes = 0;
  const isDeepFrozenInert = (entry: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > maximumNodes || depth > 64) return false;
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return true;
    if (typeof entry === 'number') return Number.isFinite(entry);
    if (typeof entry !== 'object' || !Object.isFrozen(entry)) return false;
    if (Array.isArray(entry)) {
      if (Object.getPrototypeOf(entry) !== Array.prototype) return false;
      const keys = Reflect.ownKeys(entry);
      if (keys.some((key) => typeof key === 'symbol' || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key)))) return false;
      for (let index = 0; index < entry.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(entry, String(index));
        if (!descriptor || !('value' in descriptor) || !isDeepFrozenInert(descriptor.value, depth + 1)) return false;
      }
      return true;
    }
    const prototype = Object.getPrototypeOf(entry);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(entry)) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || !isDeepFrozenInert(descriptor.value, depth + 1)) return false;
    }
    return true;
  };
  if (isDeepFrozenInert(value, 0)) return value as Readonly<T>;
  return snapshotInertJson(value, label, maximumNodes);
}

export function boundedSortedIdentifiers(values: readonly string[], label: string, maximum: number): readonly string[] {
  if (!Array.isArray(values) || values.length > maximum) throw new TypeError(`${label} exceeds its item bound`);
  const snapshot = Array.from(values);
  for (const value of snapshot) assertIdentifier(value, `${label}[]`);
  return Object.freeze(sortedUnique(snapshot));
}

export function checkedAdd(left: number, right: number, label: string): number {
  assertSafeNonNegative(left, `${label}.left`);
  assertSafeNonNegative(right, `${label}.right`);
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new RangeError(`${label} exceeds safe integer range`);
  return sum;
}
