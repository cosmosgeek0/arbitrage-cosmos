import { createHash } from 'node:crypto';

export class DockContractError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'DockContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new DockContractError(code, message);
}

function assertUnicodeScalarString(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('LONE_SURROGATE', `${path} contains a lone high surrogate`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail('LONE_SURROGATE', `${path} contains a lone low surrogate`);
    }
  }
}

function assertCanonicalJsonValue(value, path, stack) {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    assertUnicodeScalarString(value, path);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('NON_FINITE_NUMBER', `${path} must be a finite JSON number`);
    return;
  }
  if (typeof value !== 'object') fail('NON_JSON_VALUE', `${path} is not a JSON value`);
  if (stack.has(value)) fail('CYCLIC_VALUE', `${path} contains a cycle`);

  stack.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) fail('SPARSE_ARRAY', `${path}[${index}] is a sparse array slot`);
      assertCanonicalJsonValue(value[index], `${path}[${index}]`, stack);
    }
    stack.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('NON_PLAIN_OBJECT', `${path} must be a plain object`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string')) fail('SYMBOL_KEY', `${path} contains a symbol key`);
  const enumerableKeys = Object.keys(value);
  if (ownKeys.length !== enumerableKeys.length) fail('HIDDEN_PROPERTY', `${path} contains a non-enumerable property`);
  for (const key of enumerableKeys) {
    assertUnicodeScalarString(key, `${path} key`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
      fail('ACCESSOR_PROPERTY', `${path}.${key} must be a data property`);
    }
    assertCanonicalJsonValue(descriptor.value, `${path}.${key}`, stack);
  }
  stack.delete(value);
}

function serialize(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => serialize(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`).join(',')}}`;
}

export function canonicalize(value) {
  assertCanonicalJsonValue(value, '$', new WeakSet());
  return serialize(value);
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), 'utf8');
}

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? value
    : typeof value === 'string'
      ? Buffer.from(value, 'utf8')
      : canonicalBytes(value);
  return createHash('sha256').update(bytes).digest('hex');
}

export function cloneCanonical(value) {
  return JSON.parse(canonicalize(value));
}

export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function omitFields(record, fields) {
  const omitted = new Set(fields);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !omitted.has(key)));
}

export function hashRecord(record, hashField) {
  return sha256(omitFields(record, [hashField]));
}

export function assertHash(record, hashField, code = 'HASH_MISMATCH') {
  if (typeof record?.[hashField] !== 'string' || record[hashField] !== hashRecord(record, hashField)) {
    fail(code, `${hashField} does not match canonical record bytes`);
  }
  return true;
}

export function contractError(code, message) {
  return new DockContractError(code, message);
}
