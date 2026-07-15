import { cloneCanonical, deepFreeze } from '../../dock/src/index.mjs';
import { fail } from './errors.mjs';

export { cloneCanonical, deepFreeze };

export function asRecord(value, name = 'value') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('RECORD_REQUIRED', `${name} must be an object`);
  }
  return value;
}

export function boundedString(value, name, maximum = 2_048) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > maximum) {
    fail('STRING_INVALID', `${name} must be non-empty trimmed text of at most ${maximum} characters`);
  }
  if ([...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    fail('STRING_CONTROL_CHARACTER', `${name} cannot contain control characters`);
  }
  return value;
}

export function optionalString(value, name, maximum = 2_048) {
  if (value === null) return null;
  return boundedString(value, name, maximum);
}

export function enumValue(value, allowed, name) {
  if (!allowed.includes(value)) fail('ENUM_INVALID', `${name} has unsupported value ${String(value)}`);
  return value;
}

export function safeInteger(value, name, { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum || Object.is(value, -0)) {
    fail('INTEGER_INVALID', `${name} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

export function utcMillis(value, name) {
  return safeInteger(value, name, { minimum: 0, maximum: 8_640_000_000_000_000 });
}

export function booleanValue(value, name) {
  if (typeof value !== 'boolean') fail('BOOLEAN_INVALID', `${name} must be boolean`);
  return value;
}

export function arrayValue(value, name, { minimum = 0, maximum = 1_024 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail('ARRAY_INVALID', `${name} must contain between ${minimum} and ${maximum} entries`);
  }
  return value;
}

export function sortedUniqueStrings(value, name, { allowEmpty = true, maximum = 512 } = {}) {
  arrayValue(value, name, { minimum: allowEmpty ? 0 : 1, maximum });
  const checked = value.map((entry, index) => boundedString(entry, `${name}[${index}]`));
  const sorted = [...new Set(checked)].sort();
  if (sorted.length !== checked.length || sorted.some((entry, index) => entry !== checked[index])) {
    fail('SORTED_UNIQUE_REQUIRED', `${name} must be sorted and unique`);
  }
  return checked;
}

export function requireFields(record, fields, name) {
  asRecord(record, name);
  for (const field of fields) {
    if (!Object.hasOwn(record, field)) fail('REQUIRED_FIELD_MISSING', `${name}.${field} is required`);
  }
  return record;
}

export function exactFields(record, fields, name) {
  requireFields(record, fields, name);
  const allowed = new Set(fields);
  const unexpected = Object.keys(record).filter((field) => !allowed.has(field)).sort();
  if (unexpected.length > 0) fail('UNEXPECTED_FIELD', `${name} contains unsupported fields: ${unexpected.join(',')}`);
  return record;
}

export function stableSort(records, selector) {
  return [...records].sort((left, right) => {
    const leftKey = selector(left);
    const rightKey = selector(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}
