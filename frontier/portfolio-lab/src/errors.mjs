import { canonicalize } from '../../dock/src/canonical.mjs';

export class PortfolioLabContractError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'PortfolioLabContractError';
    this.code = code;
  }
}

export function fail(code, message) {
  throw new PortfolioLabContractError(code, message);
}

export function asRecord(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('RECORD_REQUIRED', `${name} must be a plain record`);
  }
  return value;
}

export function requireFields(value, fields, name) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) fail('REQUIRED_FIELD_MISSING', `${name}.${field} is required`);
  }
}

export function exactFields(value, allowed, name) {
  const unknown = Object.keys(value).filter((field) => !allowed.includes(field));
  if (unknown.length > 0) fail('UNKNOWN_FIELD', `${name} has unsupported fields: ${unknown.sort().join(',')}`);
}

export function boundedString(value, name, maximum = 2_048) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.length > maximum) {
    fail('STRING_INVALID', `${name} must be a trimmed non-empty string of at most ${maximum} characters`);
  }
  return value;
}

export function stringArray(value, name, maximum = 512) {
  if (!Array.isArray(value) || value.length > maximum) fail('STRING_ARRAY_INVALID', `${name} must be a bounded array`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail('SPARSE_ARRAY', `${name}[${index}] is a sparse array slot`);
    boundedString(value[index], `${name}[${index}]`);
  }
  if (new Set(value).size !== value.length) fail('DUPLICATE_ARRAY_VALUE', `${name} contains duplicates`);
  return value;
}

export function enumValue(value, allowed, name) {
  if (!allowed.includes(value)) fail('ENUM_INVALID', `${name} has unsupported value ${String(value)}`);
  return value;
}

export function safeInteger(value, name, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum || Object.is(value, -0)) {
    fail('INTEGER_INVALID', `${name} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

const FORBIDDEN_FIELD = /(?:api[_-]?key|api[_-]?secret|secret|password|passphrase|private[_-]?key|listen[_-]?key|credential|order[_-]?(?:request|instruction|command)|execution[_-]?(?:instruction|command)|target[_-]?size|recommended[_-]?size|approved[_-]?capital|capital[_-]?allocation|reserve[_-]?command|risk[_-]?verdict|live[_-]?send[_-]?permission|withdraw(?:al)?|transfer[_-]?out|borrow[_-]?command|repay[_-]?command|leverage[_-]?mutation)/i;

export function assertNoForbiddenCapabilities(value, path = '$', seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return true;
  if (seen.has(value)) fail('CYCLIC_VALUE', `${path} contains a cycle`);
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('NON_JSON_VALUE', `${path} contains a symbol key`);
    if (FORBIDDEN_FIELD.test(key)) fail('FORBIDDEN_CAPABILITY_FIELD', `${path}.${key} is forbidden in PortfolioLab`);
    assertNoForbiddenCapabilities(value[key], `${path}.${key}`, seen);
  }
  seen.delete(value);
  return true;
}

export function assertCanonicalJson(value, name) {
  try {
    canonicalize(value);
  } catch (error) {
    fail('NON_CANONICAL_JSON', `${name} is not canonical JSON: ${error.message}`);
  }
  return true;
}

export function rethrowDock(error) {
  if (error && typeof error.code === 'string') fail(error.code, error.message);
  throw error;
}
