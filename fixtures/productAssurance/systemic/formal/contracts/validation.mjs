const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const ID = /^[A-Z0-9][A-Z0-9._:-]{1,159}$/;

export function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function issue(path, code, detail) {
  return Object.freeze({ path, code, detail });
}

export function exactKeys(value, required, path, issues) {
  if (!isPlainObject(value)) {
    issues.push(issue(path, 'OBJECT_REQUIRED', 'value must be a plain object'));
    return false;
  }
  const expected = new Set(required);
  let exact = true;
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      issues.push(issue(`${path}.${key}`, 'FIELD_REQUIRED', 'required field is absent'));
      exact = false;
    }
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      issues.push(issue(`${path}.${key}`, 'UNKNOWN_FIELD', 'field is not allowed'));
      exact = false;
    }
  }
  return exact;
}

export function boundedString(value, path, issues, { min = 1, max = 500, pattern = null } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || value.trim() !== value || (pattern !== null && !pattern.test(value))) {
    issues.push(issue(path, 'STRING_INVALID', `expected trimmed string length ${min}..${max}`));
    return false;
  }
  return true;
}

export function enumValue(value, allowed, path, issues) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    issues.push(issue(path, 'ENUM_INVALID', `expected one of ${allowed.join(',')}`));
    return false;
  }
  return true;
}

export function safeInteger(value, path, issues, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    issues.push(issue(path, 'INTEGER_INVALID', `expected safe integer ${min}..${max}`));
    return false;
  }
  return true;
}

export function boundedStringArray(value, path, issues, { min = 0, max = 64, itemMax = 500, pattern = null } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    issues.push(issue(path, 'ARRAY_BOUNDS', `expected array length ${min}..${max}`));
    return false;
  }
  for (let index = 0; index < value.length; index += 1) boundedString(value[index], `${path}[${index}]`, issues, { max: itemMax, pattern });
  return true;
}

export function sha256(value, path, issues) {
  return boundedString(value, path, issues, { min: 64, max: 64, pattern: SHA256 });
}

export function gitSha(value, path, issues) {
  return boundedString(value, path, issues, { min: 40, max: 40, pattern: GIT_SHA });
}

export function stableId(value, path, issues) {
  return boundedString(value, path, issues, { min: 2, max: 160, pattern: ID });
}

export function result(value, issues) {
  return issues.length === 0
    ? Object.freeze({ ok: true, value })
    : Object.freeze({ ok: false, issues: Object.freeze([...issues]) });
}
