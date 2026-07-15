import {
  cloneCanonical,
  contractError,
  deepFreeze,
  sha256,
} from '../../dock/src/index.mjs';
import { ARENA_LIMITS } from './constants.mjs';

export function fail(code, message) {
  throw contractError(code, message);
}

export function record(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('ARENA_RECORD_REQUIRED', `${name} must be an object`);
  }
  return value;
}

export function exactShape(value, fields, name) {
  record(value, name);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    fail('ARENA_RECORD_SHAPE_INVALID', `${name} must contain exactly the frozen V1 fields`);
  }
}

export function boundedString(value, name, maximum = ARENA_LIMITS.maxStringLength) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.length > maximum) {
    fail('ARENA_STRING_INVALID', `${name} must be a trimmed non-empty string of at most ${maximum} characters`);
  }
  return value;
}

export function nullableString(value, name, maximum = ARENA_LIMITS.maxStringLength) {
  if (value !== null) boundedString(value, name, maximum);
  return value;
}

export function enumValue(value, allowed, name) {
  if (!allowed.includes(value)) fail('ARENA_ENUM_INVALID', `${name} has unsupported value ${String(value)}`);
  return value;
}

export function booleanValue(value, name) {
  if (typeof value !== 'boolean') fail('ARENA_BOOLEAN_INVALID', `${name} must be boolean`);
  return value;
}

export function safeInteger(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum || value > maximum) {
    fail('ARENA_INTEGER_INVALID', `${name} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

export function sha40(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) fail('ARENA_GIT_HASH_INVALID', `${name} must be a lowercase Git object SHA`);
  return value;
}

export function sha256Value(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('ARENA_SHA256_INVALID', `${name} must be a lowercase SHA-256 digest`);
  return value;
}

export function microsString(value, name, { nonNegative = false } = {}) {
  if (typeof value !== 'string' || value.length > 32 || !/^(?:0|-?[1-9][0-9]*)$/.test(value) || value === '-0') {
    fail('ARENA_MICROS_INVALID', `${name} must be a canonical base-10 integer string`);
  }
  const parsed = BigInt(value);
  if (parsed < -ARENA_LIMITS.maxMicrosAbsolute || parsed > ARENA_LIMITS.maxMicrosAbsolute || (nonNegative && parsed < 0n)) {
    fail('ARENA_MICROS_INVALID', `${name} exceeds the bounded exact-micros envelope`);
  }
  return value;
}

export function addMicros(values, name) {
  let total = 0n;
  for (const [index, value] of values.entries()) {
    microsString(value, `${name}[${index}]`);
    total += BigInt(value);
    if (total < -ARENA_LIMITS.maxMicrosAbsolute || total > ARENA_LIMITS.maxMicrosAbsolute) {
      fail('ARENA_MICROS_OVERFLOW', `${name} exceeded the bounded exact-micros envelope`);
    }
  }
  return total.toString();
}

export function negateMicros(value, name) {
  microsString(value, name);
  const parsed = -BigInt(value);
  if (parsed === 0n) return '0';
  return parsed.toString();
}

export function ppm(numerator, denominator) {
  safeInteger(numerator, 'ppm.numerator');
  safeInteger(denominator, 'ppm.denominator');
  if (denominator === 0) return null;
  const scaled = BigInt(numerator) * BigInt(ARENA_LIMITS.ppmScale);
  return Number((scaled + BigInt(Math.floor(denominator / 2))) / BigInt(denominator));
}

export function stringArray(value, name, { allowEmpty = false, sorted = true, maximum = ARENA_LIMITS.maxStrings } = {}) {
  if (!Array.isArray(value) || value.length > maximum) fail('ARENA_STRING_ARRAY_INVALID', `${name} must be a bounded array`);
  if (!allowEmpty && value.length === 0) fail('ARENA_STRING_ARRAY_EMPTY', `${name} must not be empty`);
  value.forEach((entry, index) => boundedString(entry, `${name}[${index}]`));
  if (new Set(value).size !== value.length) fail('ARENA_STRING_ARRAY_DUPLICATE', `${name} contains duplicates`);
  if (sorted && value.some((entry, index) => entry !== [...value].sort()[index])) fail('ARENA_STRING_ARRAY_ORDER_INVALID', `${name} must be sorted`);
  return value;
}

export function gitRefString(value, name) {
  boundedString(value, name);
  const match = /^git:([a-f0-9]{40}):([^#]+)(?:#(.+))?$/.exec(value);
  if (!match || match[2].startsWith('/') || match[2].endsWith('/') || match[2].includes('..') || match[2].includes('//') || /[*?\[\]{}]/.test(match[2])) {
    fail('ARENA_GIT_REF_INVALID', `${name} must pin one exact commit and safe repository path`);
  }
  return value;
}

export function immutableGitRef(value, name) {
  exactShape(value, [
    'ref',
    'gitObjectSha',
    'contentSha256',
    'projectionSha256',
    'schemaId',
    'schemaVersion',
    'posture',
  ], name);
  gitRefString(value.ref, `${name}.ref`);
  sha40(value.gitObjectSha, `${name}.gitObjectSha`);
  sha256Value(value.contentSha256, `${name}.contentSha256`);
  if (value.projectionSha256 !== null) sha256Value(value.projectionSha256, `${name}.projectionSha256`);
  boundedString(value.schemaId, `${name}.schemaId`, 256);
  boundedString(value.schemaVersion, `${name}.schemaVersion`, 128);
  enumValue(value.posture, ['CANONICAL_SOURCE', 'OWNER_CONTRACT', 'OWNER_EVIDENCE', 'SYNTHETIC_ONLY'], `${name}.posture`);
  return true;
}

export function immutableGitRefArray(value, name, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || value.length > ARENA_LIMITS.maxReferences) fail('ARENA_REFERENCE_SET_INVALID', `${name} must be a bounded array`);
  if (!allowEmpty && value.length === 0) fail('ARENA_REFERENCE_SET_EMPTY', `${name} must not be empty`);
  value.forEach((entry, index) => immutableGitRef(entry, `${name}[${index}]`));
  const refs = value.map((entry) => entry.ref);
  if (new Set(refs).size !== refs.length) fail('ARENA_REFERENCE_DUPLICATE', `${name} contains duplicate refs`);
  if (refs.some((ref, index) => ref !== [...refs].sort()[index])) fail('ARENA_REFERENCE_ORDER_INVALID', `${name} must be sorted by ref`);
  return true;
}

export function fixtureClock(value, name = 'fixtureClock') {
  exactShape(value, ['clockId', 'evaluationCutoffMs'], name);
  boundedString(value.clockId, `${name}.clockId`);
  if (!value.clockId.startsWith('fixture://')) fail('ARENA_FIXTURE_CLOCK_INVALID', `${name}.clockId must be an injected fixture URI`);
  safeInteger(value.evaluationCutoffMs, `${name}.evaluationCutoffMs`, 1);
  return true;
}

export function hashRecord(input, hashField) {
  const output = cloneCanonical(input);
  delete output[hashField];
  output[hashField] = sha256(output);
  return deepFreeze(output);
}

export function validateRecordHash(input, hashField, name) {
  sha256Value(input[hashField], `${name}.${hashField}`);
  const payload = cloneCanonical(input);
  delete payload[hashField];
  if (sha256(payload) !== input[hashField]) fail('ARENA_RECORD_HASH_MISMATCH', `${name}.${hashField} does not match canonical bytes`);
  return true;
}

export function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableSort(values, selector) {
  return [...values].sort((left, right) => {
    const a = selector(left);
    const b = selector(right);
    return compareCodeUnits(a, b);
  });
}

export function frozenClone(value) {
  return deepFreeze(cloneCanonical(value));
}
