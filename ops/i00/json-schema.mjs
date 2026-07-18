import { readFileSync } from 'node:fs';

const KNOWN_KEYWORDS = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'type', 'const', 'enum',
  'required', 'properties', 'additionalProperties', 'items', 'minItems',
  'minLength', 'pattern', 'format', 'oneOf',
]);
const SUPPORTED_TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function schemaError(label, detail) {
  throw new TypeError(`${label}: ${detail}`);
}

function describePath(path) {
  return path.length === 0 ? '$' : `$${path.map((part) => (
    typeof part === 'number' ? `[${part}]` : `.${part}`
  )).join('')}`;
}

function valueMatchesType(value, type) {
  switch (type) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}

function isDateTime(value) {
  if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

export function compileJsonSchema(schema, label = 'JSON schema') {
  if (!isObject(schema)) schemaError(label, 'root must be an object');
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    schemaError(label, 'must declare JSON Schema draft 2020-12');
  }
  const definitions = isObject(schema.$defs) ? schema.$defs : {};
  const compiling = new Set();
  const compiledDefinitions = new Map();

  const compileDefinition = (name) => {
    if (!hasOwn(definitions, name)) schemaError(label, `unresolved $ref #/$defs/${name}`);
    if (compiledDefinitions.has(name)) return compiledDefinitions.get(name);
    if (compiling.has(name)) schemaError(label, `recursive $ref #/$defs/${name} is unsupported`);
    compiling.add(name);
    const validator = compileNode(definitions[name], `#/$defs/${name}`);
    compiling.delete(name);
    compiledDefinitions.set(name, validator);
    return validator;
  };

  function compileNode(node, schemaPath) {
    if (!isObject(node)) schemaError(label, `${schemaPath} must be an object`);
    for (const key of Object.keys(node)) {
      if (!KNOWN_KEYWORDS.has(key)) schemaError(label, `${schemaPath} uses unsupported keyword ${key}`);
    }
    if (hasOwn(node, '$ref')) {
      if (typeof node.$ref !== 'string' || !node.$ref.startsWith('#/$defs/')) {
        schemaError(label, `${schemaPath} has unsupported $ref`);
      }
      const name = node.$ref.slice('#/$defs/'.length).replaceAll('~1', '/').replaceAll('~0', '~');
      const extra = Object.keys(node).filter((key) => key !== '$ref');
      if (extra.length > 0) schemaError(label, `${schemaPath} combines $ref with sibling keywords`);
      return (value, path) => compileDefinition(name)(value, path);
    }

    let acceptedTypes = null;
    if (hasOwn(node, 'type')) {
      acceptedTypes = Array.isArray(node.type) ? node.type : [node.type];
      if (acceptedTypes.length === 0 || acceptedTypes.some((type) => !SUPPORTED_TYPES.has(type))) {
        schemaError(label, `${schemaPath}.type is unsupported`);
      }
    }
    if (hasOwn(node, 'enum') && (!Array.isArray(node.enum) || node.enum.length === 0)) {
      schemaError(label, `${schemaPath}.enum must be a non-empty array`);
    }
    let pattern = null;
    if (hasOwn(node, 'pattern')) {
      if (typeof node.pattern !== 'string') schemaError(label, `${schemaPath}.pattern must be a string`);
      try { pattern = new RegExp(node.pattern, 'u'); } catch { schemaError(label, `${schemaPath}.pattern is invalid`); }
    }
    if (hasOwn(node, 'format') && node.format !== 'date-time') {
      schemaError(label, `${schemaPath}.format is unsupported`);
    }
    for (const numericKeyword of ['minLength', 'minItems']) {
      if (hasOwn(node, numericKeyword)
          && (!Number.isSafeInteger(node[numericKeyword]) || node[numericKeyword] < 0)) {
        schemaError(label, `${schemaPath}.${numericKeyword} must be a non-negative safe integer`);
      }
    }

    const propertyValidators = new Map();
    if (hasOwn(node, 'properties')) {
      if (!isObject(node.properties)) schemaError(label, `${schemaPath}.properties must be an object`);
      for (const [name, child] of Object.entries(node.properties)) {
        propertyValidators.set(name, compileNode(child, `${schemaPath}/properties/${name}`));
      }
    }
    let required = [];
    if (hasOwn(node, 'required')) {
      if (!Array.isArray(node.required)
          || node.required.some((name) => typeof name !== 'string')
          || new Set(node.required).size !== node.required.length) {
        schemaError(label, `${schemaPath}.required must contain unique strings`);
      }
      required = node.required;
    }
    if (hasOwn(node, 'additionalProperties') && node.additionalProperties !== false) {
      schemaError(label, `${schemaPath}.additionalProperties supports only false`);
    }
    const itemValidator = hasOwn(node, 'items')
      ? compileNode(node.items, `${schemaPath}/items`)
      : null;
    const oneOf = hasOwn(node, 'oneOf')
      ? (() => {
          if (!Array.isArray(node.oneOf) || node.oneOf.length === 0) {
            schemaError(label, `${schemaPath}.oneOf must be a non-empty array`);
          }
          return node.oneOf.map((child, index) => compileNode(child, `${schemaPath}/oneOf/${index}`));
        })()
      : null;

    return (value, path = []) => {
      const location = describePath(path);
      if (acceptedTypes && !acceptedTypes.some((type) => valueMatchesType(value, type))) {
        return `${location} has the wrong type`;
      }
      if (hasOwn(node, 'const') && !Object.is(value, node.const)) {
        return `${location} does not equal the required constant`;
      }
      if (hasOwn(node, 'enum') && !node.enum.some((entry) => Object.is(entry, value))) {
        return `${location} is outside the allowed enum`;
      }
      if (typeof value === 'string') {
        if (hasOwn(node, 'minLength') && value.length < node.minLength) return `${location} is too short`;
        if (pattern && !pattern.test(value)) return `${location} does not match the required pattern`;
        if (node.format === 'date-time' && !isDateTime(value)) return `${location} is not a valid date-time`;
      }
      if (Array.isArray(value)) {
        if (hasOwn(node, 'minItems') && value.length < node.minItems) return `${location} has too few items`;
        if (itemValidator) {
          for (let index = 0; index < value.length; index += 1) {
            const error = itemValidator(value[index], [...path, index]);
            if (error) return error;
          }
        }
      }
      if (isObject(value)) {
        for (const name of required) {
          if (!hasOwn(value, name)) return `${location}.${name} is required`;
        }
        if (node.additionalProperties === false) {
          const unexpected = Object.keys(value).filter((name) => !propertyValidators.has(name));
          if (unexpected.length > 0) return `${location} has unexpected field ${unexpected.sort()[0]}`;
        }
        for (const [name, validator] of propertyValidators) {
          if (!hasOwn(value, name)) continue;
          const error = validator(value[name], [...path, name]);
          if (error) return error;
        }
      }
      if (oneOf) {
        const matches = oneOf.reduce((count, validator) => count + (validator(value, path) ? 0 : 1), 0);
        if (matches !== 1) return `${location} must match exactly one oneOf branch`;
      }
      return null;
    };
  }

  const validate = compileNode(schema, '#');
  for (const name of Object.keys(definitions)) compileDefinition(name);
  return Object.freeze((value) => {
    const error = validate(value, []);
    return Object.freeze({ valid: error === null, error });
  });
}

export function compileJsonSchemaFile(url, label = 'JSON schema') {
  let schema;
  try {
    schema = JSON.parse(readFileSync(url, 'utf8'));
  } catch (error) {
    schemaError(label, `cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  return compileJsonSchema(schema, label);
}
