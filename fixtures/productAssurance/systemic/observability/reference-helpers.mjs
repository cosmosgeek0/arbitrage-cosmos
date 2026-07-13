const MAX_SAFE_COUNT = Number.MAX_SAFE_INTEGER;

export const EVALUATION_RESULTS = Object.freeze(['PASS', 'FAIL', 'UNKNOWN']);

export function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertClosedRecord(value, path, requiredKeys, optionalKeys = []) {
  if (!isPlainRecord(value)) throw new TypeError(`${path} must be an object`);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not allowed`);
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${path}.${key} is required`);
  }
  return value;
}

export function assertArray(value, path, maximumLength) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  if (value.length > maximumLength) throw new RangeError(`${path} exceeds ${maximumLength} entries`);
  return value;
}

export function assertBoolean(value, path) {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be boolean`);
  return value;
}

export function assertSafeInteger(value, path, minimum = 0, maximum = MAX_SAFE_COUNT) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${path} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

export function assertFiniteNumber(value, path, minimum = 0, maximum = MAX_SAFE_COUNT) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${path} must be finite and in [${minimum}, ${maximum}]`);
  }
  return value;
}

export function assertBoundedString(value, path, minimumLength = 1, maximumLength = 160) {
  if (typeof value !== 'string' || value.length < minimumLength || value.length > maximumLength) {
    throw new TypeError(`${path} must be a string with length ${minimumLength}..${maximumLength}`);
  }
  return value;
}

export function assertEnum(value, allowed, path) {
  if (!allowed.includes(value)) throw new TypeError(`${path} is not in the closed vocabulary`);
  return value;
}

export function assertSha256(value, path) {
  assertBoundedString(value, path, 64, 64);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`);
  return value;
}

export function assertGitSha(value, path) {
  assertBoundedString(value, path, 40, 64);
  if (!/^[0-9a-f]{40,64}$/.test(value)) throw new TypeError(`${path} must be a lowercase immutable revision digest`);
  return value;
}

export function assertUnique(values, keyOf, path) {
  const seen = new Set();
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) throw new TypeError(`${path} contains duplicate key ${key}`);
    seen.add(key);
  }
}

export function strongestResult(results) {
  if (results.includes('FAIL')) return 'FAIL';
  if (results.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
}

export function roundedRatio(numerator, denominator) {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1_000_000) / 1_000_000;
}

export function roundedPercent(numerator, denominator) {
  const ratio = roundedRatio(numerator, denominator);
  return ratio === null ? null : Math.round(ratio * 100_000_000) / 1_000_000;
}

export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function sortedUniqueStrings(values) {
  return [...new Set(values)].sort(compareAscii);
}
