/**
 * Dependency-free JSON Schema Draft 2020-12 subset used by the packet tests.
 *
 * This deliberately rejects schema keywords outside the subset exercised by
 * the S5 packet. That makes schema drift visible instead of silently treating
 * an unevaluated keyword as passing validation.
 */

const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', '$defs', '$ref',
  'title', 'description',
  'oneOf', 'const', 'enum', 'type',
  'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems',
  'minLength', 'maxLength', 'pattern',
  'minimum', 'maximum', 'exclusiveMinimum',
]);

const JSON_TYPES = new Set([
  'null', 'boolean', 'object', 'array', 'number', 'integer', 'string',
]);

export class SchemaSubsetError extends TypeError {
  constructor(code, schemaPath, detail) {
    super(`${code} at ${schemaPath}: ${detail}`);
    this.name = 'SchemaSubsetError';
    this.code = code;
    this.schemaPath = schemaPath;
  }
}

function schemaFail(code, schemaPath, detail) {
  throw new SchemaSubsetError(code, schemaPath, detail);
}

function escapePointerToken(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function joinPointer(base, token) {
  return `${base}/${escapePointerToken(token)}`;
}

function isSchema(value) {
  return typeof value === 'boolean'
    || (typeof value === 'object' && value !== null && !Array.isArray(value));
}

function assertNonNegativeInteger(value, schemaPath) {
  if (!Number.isSafeInteger(value) || value < 0) {
    schemaFail('SCHEMA_VALUE_INVALID', schemaPath, 'expected a non-negative safe integer');
  }
}

function assertFiniteNumber(value, schemaPath) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    schemaFail('SCHEMA_VALUE_INVALID', schemaPath, 'expected a finite number');
  }
}

function resolveInternalRef(rootSchema, reference, schemaPath) {
  if (reference === '#') return rootSchema;
  if (typeof reference !== 'string' || !reference.startsWith('#/')) {
    schemaFail('EXTERNAL_REF_UNSUPPORTED', schemaPath, 'only internal JSON Pointer references are supported');
  }
  let current = rootSchema;
  for (const encodedToken of reference.slice(2).split('/')) {
    const token = encodedToken.replaceAll('~1', '/').replaceAll('~0', '~');
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, token)) {
      schemaFail('REF_NOT_FOUND', schemaPath, `unresolved reference ${reference}`);
    }
    current = current[token];
  }
  if (!isSchema(current)) {
    schemaFail('REF_NOT_SCHEMA', schemaPath, `reference ${reference} does not resolve to a schema`);
  }
  return current;
}

function inspectSchema(schema, rootSchema, schemaPath, inspected) {
  if (typeof schema === 'boolean') return;
  if (!isSchema(schema)) schemaFail('SCHEMA_INVALID', schemaPath, 'expected an object or boolean schema');
  if (inspected.has(schema)) return;
  inspected.add(schema);

  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      schemaFail('UNSUPPORTED_SCHEMA_KEYWORD', joinPointer(schemaPath, keyword), `keyword ${keyword} is outside the packet subset`);
    }
  }

  if (Object.hasOwn(schema, '$ref')) {
    const resolved = resolveInternalRef(rootSchema, schema.$ref, joinPointer(schemaPath, '$ref'));
    inspectSchema(resolved, rootSchema, schema.$ref, inspected);
  }
  if (Object.hasOwn(schema, '$defs')) {
    if (typeof schema.$defs !== 'object' || schema.$defs === null || Array.isArray(schema.$defs)) {
      schemaFail('SCHEMA_VALUE_INVALID', joinPointer(schemaPath, '$defs'), 'expected an object of schemas');
    }
    for (const [name, child] of Object.entries(schema.$defs)) {
      inspectSchema(child, rootSchema, joinPointer(joinPointer(schemaPath, '$defs'), name), inspected);
    }
  }
  if (Object.hasOwn(schema, 'oneOf')) {
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length === 0) {
      schemaFail('SCHEMA_VALUE_INVALID', joinPointer(schemaPath, 'oneOf'), 'expected a non-empty schema array');
    }
    schema.oneOf.forEach((child, index) => inspectSchema(
      child,
      rootSchema,
      joinPointer(joinPointer(schemaPath, 'oneOf'), index),
      inspected,
    ));
  }
  if (Object.hasOwn(schema, 'type')) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (types.length === 0 || types.some((entry) => !JSON_TYPES.has(entry)) || new Set(types).size !== types.length) {
      schemaFail('SCHEMA_VALUE_INVALID', joinPointer(schemaPath, 'type'), 'expected unique JSON type names');
    }
  }
  if (Object.hasOwn(schema, 'enum') && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    schemaFail('SCHEMA_VALUE_INVALID', joinPointer(schemaPath, 'enum'), 'expected a non-empty array');
  }
  if (Object.hasOwn(schema, 'required')) {
    if (!Array.isArray(schema.required)
        || schema.required.some((entry) => typeof entry !== 'string')
        || new Set(schema.required).size !== schema.required.length) {
      schemaFail('SCHEMA_VALUE_INVALID', joinPointer(schemaPath, 'required'), 'expected unique property names');
    }
  }
  if (Object.hasOwn(schema, 'properties')) {
    if (typeof schema.properties !== 'object' || schema.properties === null || Array.isArray(schema.properties)) {
      schemaFail('SCHEMA_VALUE_INVALID', joinPointer(schemaPath, 'properties'), 'expected an object of schemas');
    }
    for (const [name, child] of Object.entries(schema.properties)) {
      inspectSchema(child, rootSchema, joinPointer(joinPointer(schemaPath, 'properties'), name), inspected);
    }
  }
  if (Object.hasOwn(schema, 'additionalProperties')) {
    if (schema.additionalProperties !== false && schema.additionalProperties !== true) {
      inspectSchema(
        schema.additionalProperties,
        rootSchema,
        joinPointer(schemaPath, 'additionalProperties'),
        inspected,
      );
    }
  }
  if (Object.hasOwn(schema, 'items')) {
    inspectSchema(schema.items, rootSchema, joinPointer(schemaPath, 'items'), inspected);
  }
  for (const keyword of ['minItems', 'maxItems', 'minLength', 'maxLength']) {
    if (Object.hasOwn(schema, keyword)) assertNonNegativeInteger(schema[keyword], joinPointer(schemaPath, keyword));
  }
  if (Object.hasOwn(schema, 'minItems') && Object.hasOwn(schema, 'maxItems') && schema.minItems > schema.maxItems) {
    schemaFail('SCHEMA_VALUE_INVALID', schemaPath, 'minItems exceeds maxItems');
  }
  if (Object.hasOwn(schema, 'minLength') && Object.hasOwn(schema, 'maxLength') && schema.minLength > schema.maxLength) {
    schemaFail('SCHEMA_VALUE_INVALID', schemaPath, 'minLength exceeds maxLength');
  }
  if (Object.hasOwn(schema, 'uniqueItems') && typeof schema.uniqueItems !== 'boolean') {
    schemaFail('SCHEMA_VALUE_INVALID', joinPointer(schemaPath, 'uniqueItems'), 'expected a boolean');
  }
  if (Object.hasOwn(schema, 'pattern')) {
    if (typeof schema.pattern !== 'string') schemaFail('SCHEMA_VALUE_INVALID', joinPointer(schemaPath, 'pattern'), 'expected a string');
    try {
      new RegExp(schema.pattern, 'u');
    } catch (error) {
      schemaFail('SCHEMA_VALUE_INVALID', joinPointer(schemaPath, 'pattern'), error.message);
    }
  }
  for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum']) {
    if (Object.hasOwn(schema, keyword)) assertFiniteNumber(schema[keyword], joinPointer(schemaPath, keyword));
  }
}

export function assertSchemaSubsetSupported(rootSchema) {
  if (!isSchema(rootSchema)) schemaFail('SCHEMA_INVALID', '#', 'expected an object or boolean root schema');
  inspectSchema(rootSchema, rootSchema, '#', new Set());
  return true;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function jsonEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

function actualJsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(value, expected) {
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'integer') return Number.isInteger(value) && Number.isFinite(value);
  if (expected === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'null') return value === null;
  return typeof value === expected;
}

function validationError(errors, keyword, instancePath, schemaPath, message) {
  errors.push(Object.freeze({ keyword, instancePath, schemaPath, message }));
}

function validateNode(schema, instance, context, instancePath, schemaPath, errors) {
  if (schema === true) return;
  if (schema === false) {
    validationError(errors, 'falseSchema', instancePath, schemaPath, 'boolean false schema rejects every value');
    return;
  }

  if (Object.hasOwn(schema, '$ref')) {
    const referencePath = joinPointer(schemaPath, '$ref');
    const resolved = resolveInternalRef(context.rootSchema, schema.$ref, referencePath);
    validateNode(resolved, instance, context, instancePath, schema.$ref, errors);
  }

  if (Object.hasOwn(schema, 'oneOf')) {
    let passingBranches = 0;
    for (let index = 0; index < schema.oneOf.length; index += 1) {
      const branchErrors = [];
      validateNode(
        schema.oneOf[index],
        instance,
        context,
        instancePath,
        joinPointer(joinPointer(schemaPath, 'oneOf'), index),
        branchErrors,
      );
      if (branchErrors.length === 0) passingBranches += 1;
    }
    if (passingBranches !== 1) {
      validationError(
        errors,
        'oneOf',
        instancePath,
        joinPointer(schemaPath, 'oneOf'),
        `expected exactly one matching branch; found ${passingBranches}`,
      );
    }
  }

  if (Object.hasOwn(schema, 'const') && !jsonEqual(instance, schema.const)) {
    validationError(errors, 'const', instancePath, joinPointer(schemaPath, 'const'), 'value does not equal const');
  }
  if (Object.hasOwn(schema, 'enum') && !schema.enum.some((entry) => jsonEqual(instance, entry))) {
    validationError(errors, 'enum', instancePath, joinPointer(schemaPath, 'enum'), 'value is not in enum');
  }

  if (Object.hasOwn(schema, 'type')) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expectedTypes.some((expected) => typeMatches(instance, expected))) {
      validationError(
        errors,
        'type',
        instancePath,
        joinPointer(schemaPath, 'type'),
        `expected ${expectedTypes.join('|')}; found ${actualJsonType(instance)}`,
      );
      return;
    }
  }

  if (typeof instance === 'string') {
    const length = [...instance].length;
    if (Object.hasOwn(schema, 'minLength') && length < schema.minLength) {
      validationError(errors, 'minLength', instancePath, joinPointer(schemaPath, 'minLength'), `length ${length} is below ${schema.minLength}`);
    }
    if (Object.hasOwn(schema, 'maxLength') && length > schema.maxLength) {
      validationError(errors, 'maxLength', instancePath, joinPointer(schemaPath, 'maxLength'), `length ${length} exceeds ${schema.maxLength}`);
    }
    if (Object.hasOwn(schema, 'pattern') && !(new RegExp(schema.pattern, 'u')).test(instance)) {
      validationError(errors, 'pattern', instancePath, joinPointer(schemaPath, 'pattern'), 'string does not match pattern');
    }
  }

  if (typeof instance === 'number' && Number.isFinite(instance)) {
    if (Object.hasOwn(schema, 'minimum') && instance < schema.minimum) {
      validationError(errors, 'minimum', instancePath, joinPointer(schemaPath, 'minimum'), `${instance} is below ${schema.minimum}`);
    }
    if (Object.hasOwn(schema, 'maximum') && instance > schema.maximum) {
      validationError(errors, 'maximum', instancePath, joinPointer(schemaPath, 'maximum'), `${instance} exceeds ${schema.maximum}`);
    }
    if (Object.hasOwn(schema, 'exclusiveMinimum') && instance <= schema.exclusiveMinimum) {
      validationError(errors, 'exclusiveMinimum', instancePath, joinPointer(schemaPath, 'exclusiveMinimum'), `${instance} is not greater than ${schema.exclusiveMinimum}`);
    }
  }

  if (Array.isArray(instance)) {
    if (Object.hasOwn(schema, 'minItems') && instance.length < schema.minItems) {
      validationError(errors, 'minItems', instancePath, joinPointer(schemaPath, 'minItems'), `item count ${instance.length} is below ${schema.minItems}`);
    }
    if (Object.hasOwn(schema, 'maxItems') && instance.length > schema.maxItems) {
      validationError(errors, 'maxItems', instancePath, joinPointer(schemaPath, 'maxItems'), `item count ${instance.length} exceeds ${schema.maxItems}`);
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      instance.forEach((entry, index) => {
        const key = stableJson(entry);
        if (seen.has(key)) {
          validationError(errors, 'uniqueItems', joinPointer(instancePath, index), joinPointer(schemaPath, 'uniqueItems'), 'duplicate array item');
        }
        seen.add(key);
      });
    }
    if (Object.hasOwn(schema, 'items')) {
      instance.forEach((entry, index) => validateNode(
        schema.items,
        entry,
        context,
        joinPointer(instancePath, index),
        joinPointer(schemaPath, 'items'),
        errors,
      ));
    }
  }

  if (typeof instance === 'object' && instance !== null && !Array.isArray(instance)) {
    if (Object.hasOwn(schema, 'required')) {
      for (const property of schema.required) {
        if (!Object.hasOwn(instance, property)) {
          validationError(errors, 'required', instancePath, joinPointer(schemaPath, 'required'), `missing required property ${property}`);
        }
      }
    }
    const declared = schema.properties ?? {};
    for (const [property, childSchema] of Object.entries(declared)) {
      if (Object.hasOwn(instance, property)) {
        validateNode(
          childSchema,
          instance[property],
          context,
          joinPointer(instancePath, property),
          joinPointer(joinPointer(schemaPath, 'properties'), property),
          errors,
        );
      }
    }
    for (const property of Object.keys(instance)) {
      if (Object.hasOwn(declared, property)) continue;
      if (schema.additionalProperties === false) {
        validationError(
          errors,
          'additionalProperties',
          joinPointer(instancePath, property),
          joinPointer(schemaPath, 'additionalProperties'),
          `unexpected property ${property}`,
        );
      } else if (isSchema(schema.additionalProperties)) {
        validateNode(
          schema.additionalProperties,
          instance[property],
          context,
          joinPointer(instancePath, property),
          joinPointer(schemaPath, 'additionalProperties'),
          errors,
        );
      }
    }
  }
}

export function validateJsonSchema(rootSchema, instance) {
  assertSchemaSubsetSupported(rootSchema);
  const errors = [];
  validateNode(rootSchema, instance, { rootSchema }, '#', '#', errors);
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertJsonSchemaValid(rootSchema, instance, label = 'instance') {
  const result = validateJsonSchema(rootSchema, instance);
  if (!result.valid) {
    const detail = result.errors
      .map((error) => `${error.instancePath} [${error.keyword}] ${error.message}`)
      .join('; ');
    throw new TypeError(`${label} failed schema validation: ${detail}`);
  }
  return true;
}
