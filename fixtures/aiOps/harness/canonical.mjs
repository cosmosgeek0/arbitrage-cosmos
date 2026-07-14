import { createHash } from 'node:crypto';

export function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalStringify(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical data cannot contain a non-finite number');
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError('canonical data cannot contain an unsafe integer');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(',')}]`;
  }
  if (isPlainRecord(value)) {
    const ownKeys = Reflect.ownKeys(value);
    const enumerableStringKeys = Object.keys(value);
    if (ownKeys.length !== enumerableStringKeys.length || ownKeys.some((key) => typeof key !== 'string')) {
      throw new TypeError('canonical data cannot contain symbol or non-enumerable properties');
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, 'value'))) {
      throw new TypeError('canonical data cannot contain accessor properties');
    }
    return `{${enumerableStringKeys
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('canonical data must be JSON-plain and defined');
}

export function sha256Hex(value) {
  const encoded = typeof value === 'string'
    ? `text\u0000${value}`
    : `json\u0000${canonicalStringify(value)}`;
  return createHash('sha256').update(encoded, 'utf8').digest('hex');
}

export function compareCodeUnits(left, right) {
  return left < right ? -1 : (left > right ? 1 : 0);
}

export function stableUnique(values) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new TypeError('stableUnique requires an array of strings');
  }
  return Object.freeze([...new Set(values)].sort(compareCodeUnits));
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

export function immutableClone(value) {
  return deepFreeze(JSON.parse(canonicalStringify(value)));
}

export function hasExactKeys(value, expectedKeys) {
  if (!isPlainRecord(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string')) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) {
    return false;
  }
  const actual = ownKeys.sort(compareCodeUnits);
  const expected = [...expectedKeys].sort(compareCodeUnits);
  return canonicalStringify(actual) === canonicalStringify(expected);
}

export function assertUtcMillis(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 1_262_304_000_000 || value > 4_102_444_800_000) {
    throw new TypeError(`${fieldName} must be a safe UTC millisecond value`);
  }
  return value;
}

export function assertIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:/-]{1,180}$/u.test(value)) {
    throw new TypeError(`${fieldName} must be a bounded identifier`);
  }
  return value;
}
