import { createHash } from 'node:crypto';

import { boundedJsonByteLength } from '../../../intelligenceRuntime/contracts/boundedJson.js';

export const EDGE_PROTOCOL_V1_SCHEMA_SHA256 = '229af0ff13d600c7d305c6deb7f57b61bdb6f8a35f6f2349d91f5ab1b4972f1c' as const;

const DEFAULT_MAXIMUM_JSON_BYTES = 262_144;
const DEFAULT_MAXIMUM_JSON_DEPTH = 64;
const DEFAULT_MAXIMUM_JSON_NODES = 100_000;
const DEFAULT_MAXIMUM_VALIDATION_ISSUES = 64;
const HARD_MAXIMUM_VALIDATION_ISSUES = 1_024;
const SCHEMA_DOCUMENT_MAXIMUM_BYTES = 262_144;
const SCHEMA_DOCUMENT_MAXIMUM_NODES = 100_000;

type JsonObject = Record<string, unknown>;
type FrozenJsonObject = Readonly<Record<string, unknown>>;

export interface SchemaValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface EdgeProtocolSchemaRuntimeBounds {
  /** Parsed-envelope JSON bytes. The frozen protocol ceiling cannot be widened. */
  readonly maximumJsonBytes?: number;
  readonly maximumJsonDepth?: number;
  readonly maximumJsonNodes?: number;
  readonly maximumValidationIssues?: number;
}

export interface EdgeProtocolSchemaRuntime {
  readonly rawSha256: typeof EDGE_PROTOCOL_V1_SCHEMA_SHA256;
  readonly document: FrozenJsonObject;
  isRegisteredEnvelopeSchema(name: unknown): name is string;
  validateEnvelope(value: unknown): ReadonlyArray<Readonly<SchemaValidationIssue>>;
}

interface ResolvedRuntimeBounds {
  readonly maximumJsonBytes: number;
  readonly maximumJsonDepth: number;
  readonly maximumJsonNodes: number;
  readonly maximumValidationIssues: number;
  readonly maximumValidationSteps: number;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function optionalOwnNumber(
  input: EdgeProtocolSchemaRuntimeBounds,
  key: keyof EdgeProtocolSchemaRuntimeBounds,
  fallback: number,
): number {
  if (!Object.hasOwn(input, key)) return fallback;
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'number') {
    return Number.NaN;
  }
  return descriptor.value;
}

function resolveBounds(input: EdgeProtocolSchemaRuntimeBounds): ResolvedRuntimeBounds {
  const maximumJsonBytes = boundedInteger(
    optionalOwnNumber(input, 'maximumJsonBytes', DEFAULT_MAXIMUM_JSON_BYTES),
    'maximumJsonBytes',
    1,
    DEFAULT_MAXIMUM_JSON_BYTES,
  );
  const maximumJsonDepth = boundedInteger(
    optionalOwnNumber(input, 'maximumJsonDepth', DEFAULT_MAXIMUM_JSON_DEPTH),
    'maximumJsonDepth',
    1,
    DEFAULT_MAXIMUM_JSON_DEPTH,
  );
  const maximumJsonNodes = boundedInteger(
    optionalOwnNumber(input, 'maximumJsonNodes', DEFAULT_MAXIMUM_JSON_NODES),
    'maximumJsonNodes',
    1,
    1_000_000,
  );
  const maximumValidationIssues = boundedInteger(
    optionalOwnNumber(input, 'maximumValidationIssues', DEFAULT_MAXIMUM_VALIDATION_ISSUES),
    'maximumValidationIssues',
    1,
    HARD_MAXIMUM_VALIDATION_ISSUES,
  );

  // A schema visit can add a local $ref and anyOf visit to an already bounded
  // instance node. The multiplier bounds that trusted-schema work without
  // conflating those visits with the instance node limit.
  const maximumValidationSteps = maximumJsonNodes * 32 + 1_024;
  return Object.freeze({
    maximumJsonBytes,
    maximumJsonDepth,
    maximumJsonNodes,
    maximumValidationIssues,
    maximumValidationSteps,
  });
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownValue(object: JsonObject, key: string): unknown {
  if (!Object.hasOwn(object, key)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function codePointCompare(left: string, right: string): number {
  const leftPoints = left[Symbol.iterator]();
  const rightPoints = right[Symbol.iterator]();
  while (true) {
    const leftPoint = leftPoints.next();
    const rightPoint = rightPoints.next();
    if (leftPoint.done || rightPoint.done) {
      if (leftPoint.done === rightPoint.done) return 0;
      return leftPoint.done ? -1 : 1;
    }
    const leftCode = leftPoint.value.codePointAt(0) ?? 0;
    const rightCode = rightPoint.value.codePointAt(0) ?? 0;
    if (leftCode !== rightCode) return leftCode - rightCode;
  }
}

function codePointLength(value: string): number {
  let length = 0;
  for (const _point of value) length += 1;
  return length;
}

function appendPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function resolveLocalReference(document: FrozenJsonObject, reference: string): FrozenJsonObject | null {
  if (!reference.startsWith('#/')) return null;
  let current: unknown = document;
  for (const encodedPart of reference.slice(2).split('/')) {
    const part = encodedPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(current) || !Object.hasOwn(current, part)) return null;
    current = ownValue(current, part);
  }
  return isObject(current) ? current : null;
}

function jsonEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      const leftDescriptor = Object.getOwnPropertyDescriptor(left, String(index));
      const rightDescriptor = Object.getOwnPropertyDescriptor(right, String(index));
      if (!leftDescriptor || !rightDescriptor
        || !Object.hasOwn(leftDescriptor, 'value') || !Object.hasOwn(rightDescriptor, 'value')
        || !jsonEquals(leftDescriptor.value, rightDescriptor.value)) return false;
    }
    return true;
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort(codePointCompare);
  const rightKeys = Object.keys(right).sort(codePointCompare);
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    if (key !== rightKeys[index] || !Object.hasOwn(right, key)) return false;
    if (!jsonEquals(ownValue(left, key), ownValue(right, key))) return false;
  }
  return true;
}

function schemaTypeMatches(expected: unknown, value: unknown): boolean {
  const matchesOne = (type: unknown): boolean => {
    if (typeof type !== 'string') return false;
    switch (type) {
      case 'null':
        return value === null;
      case 'array':
        return Array.isArray(value);
      case 'object':
        return isObject(value);
      case 'integer':
        return typeof value === 'number' && Number.isSafeInteger(value);
      case 'number':
        return typeof value === 'number'
          && Number.isFinite(value)
          && (!Number.isInteger(value) || Number.isSafeInteger(value));
      case 'string':
      case 'boolean':
        return typeof value === type;
      default:
        return false;
    }
  };
  return Array.isArray(expected) ? expected.some(matchesOne) : matchesOne(expected);
}

function expectedTypeLabel(expected: unknown): string {
  if (typeof expected === 'string') return expected;
  if (Array.isArray(expected) && expected.every((item) => typeof item === 'string')) {
    return expected.join('|');
  }
  return 'declared schema type';
}

function frozenIssue(path: string, code: string, message: string): Readonly<SchemaValidationIssue> {
  return Object.freeze({ path, code, message });
}

/**
 * Creates the L-side runtime for the exact director-frozen schema bytes.
 * The caller supplies the raw text explicitly; this module performs no file,
 * environment, network, clock, timer or import-time work.
 */
export function createEdgeProtocolSchemaRuntime(
  rawSchemaText: string,
  boundsInput: EdgeProtocolSchemaRuntimeBounds = {},
): EdgeProtocolSchemaRuntime {
  if (typeof rawSchemaText !== 'string') throw new TypeError('rawSchemaText must be a string');
  const rawSha256 = createHash('sha256').update(rawSchemaText, 'utf8').digest('hex');
  if (rawSha256 !== EDGE_PROTOCOL_V1_SCHEMA_SHA256) {
    throw new Error('EDGE_PROTOCOL_V1 schema SHA-256 mismatch');
  }

  const parsed: unknown = JSON.parse(rawSchemaText);
  boundedJsonByteLength(parsed, SCHEMA_DOCUMENT_MAXIMUM_BYTES, {
    maximumDepth: DEFAULT_MAXIMUM_JSON_DEPTH,
    maximumNodes: SCHEMA_DOCUMENT_MAXIMUM_NODES,
  });
  if (!isObject(parsed)) throw new TypeError('EDGE_PROTOCOL_V1 schema document must be an object');
  const document = deepFreeze(parsed) as FrozenJsonObject;
  const definitionsValue = ownValue(parsed, '$defs');
  if (!isObject(definitionsValue)) throw new TypeError('EDGE_PROTOCOL_V1 schema document is missing $defs');
  const definitions = definitionsValue as FrozenJsonObject;
  const registeredEnvelopeNames = new Set<string>();

  for (const name of Object.keys(definitions).sort(codePointCompare)) {
    const definition = ownValue(definitions, name);
    if (!isObject(definition)) continue;
    const properties = ownValue(definition, 'properties');
    if (!isObject(properties) || !Object.hasOwn(properties, 'schema')) continue;
    const schemaProperty = ownValue(properties, 'schema');
    if (isObject(schemaProperty) && ownValue(schemaProperty, 'const') === name) {
      registeredEnvelopeNames.add(name);
    }
  }

  if (registeredEnvelopeNames.size === 0) {
    throw new TypeError('EDGE_PROTOCOL_V1 schema document contains no registered envelopes');
  }
  const bounds = resolveBounds(boundsInput);

  const isRegisteredEnvelopeSchema = (name: unknown): name is string => (
    typeof name === 'string' && registeredEnvelopeNames.has(name)
  );

  const validateEnvelope = (value: unknown): ReadonlyArray<Readonly<SchemaValidationIssue>> => {
    const issues: Array<Readonly<SchemaValidationIssue>> = [];
    let validationSteps = 0;
    let validationLimitRecorded = false;

    const addIssue = (path: string, code: string, message: string): void => {
      if (issues.length >= bounds.maximumValidationIssues) return;
      issues.push(frozenIssue(path, code, message));
    };

    try {
      boundedJsonByteLength(value, bounds.maximumJsonBytes, {
        maximumDepth: bounds.maximumJsonDepth,
        maximumNodes: bounds.maximumJsonNodes,
      });
    } catch (error) {
      const isBoundsError = error instanceof RangeError;
      addIssue(
        '$',
        isBoundsError ? 'JSON_BOUNDS_EXCEEDED' : 'JSON_VALUE_UNSUPPORTED',
        isBoundsError ? 'Envelope exceeds a configured JSON bound' : 'Envelope must be a finite plain JSON value',
      );
      return Object.freeze(issues);
    }

    const scanNumbers = (current: unknown, path: string): boolean => {
      let valid = true;
      if (typeof current === 'number') {
        if (!Number.isFinite(current)) {
          addIssue(path, 'NUMBER_NOT_FINITE', 'Numbers must be finite');
          return false;
        }
        if (Number.isInteger(current) && !Number.isSafeInteger(current)) {
          addIssue(path, 'INTEGER_NOT_SAFE', 'Integers must be safe integers');
          return false;
        }
        return true;
      }
      if (Array.isArray(current)) {
        const descriptors = Object.getOwnPropertyDescriptors(current);
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
          if (!scanNumbers(descriptor.value, `${path}[${index}]`)) valid = false;
        }
        return valid;
      }
      if (isObject(current)) {
        for (const key of Object.keys(current).sort(codePointCompare)) {
          if (!scanNumbers(ownValue(current, key), appendPath(path, key))) valid = false;
        }
      }
      return valid;
    };

    const numbersValid = scanNumbers(value, '$');

    const consumeValidationStep = (path: string): boolean => {
      validationSteps += 1;
      if (validationSteps <= bounds.maximumValidationSteps) return true;
      if (!validationLimitRecorded) {
        validationLimitRecorded = true;
        addIssue(path, 'VALIDATION_WORK_EXCEEDED', 'Envelope validation exceeds the configured work bound');
      }
      return false;
    };

    const validateAgainstSchema = (
      schema: FrozenJsonObject,
      current: unknown,
      path: string,
      emitIssues: boolean,
    ): boolean => {
      if (!consumeValidationStep(path)) return false;
      let valid = true;
      const report = (code: string, message: string, issuePath = path): void => {
        valid = false;
        if (emitIssues) addIssue(issuePath, code, message);
      };

      if (Object.hasOwn(schema, '$ref')) {
        const reference = ownValue(schema, '$ref');
        const referencedSchema = typeof reference === 'string'
          ? resolveLocalReference(document, reference)
          : null;
        if (referencedSchema === null) {
          report('SCHEMA_REFERENCE_INVALID', 'Frozen schema contains an invalid local reference');
        } else if (!validateAgainstSchema(referencedSchema, current, path, emitIssues)) {
          valid = false;
        }
      }

      if (Object.hasOwn(schema, 'anyOf')) {
        const branches = ownValue(schema, 'anyOf');
        if (!Array.isArray(branches)) {
          report('SCHEMA_ANY_OF_INVALID', 'Frozen schema contains an invalid anyOf declaration');
        } else {
          let branchMatched = false;
          for (const branch of branches) {
            if (!isObject(branch)) continue;
            if (validateAgainstSchema(branch, current, path, false)) {
              branchMatched = true;
              break;
            }
            if (validationLimitRecorded) break;
          }
          if (!branchMatched && !validationLimitRecorded) {
            report('ANY_OF_MISMATCH', 'Value does not match any allowed schema branch');
          } else if (!branchMatched) {
            valid = false;
          }
        }
      }

      if (Object.hasOwn(schema, 'const') && !jsonEquals(current, ownValue(schema, 'const'))) {
        report('CONST_MISMATCH', 'Value does not match the required constant');
      }

      if (Object.hasOwn(schema, 'enum')) {
        const allowed = ownValue(schema, 'enum');
        if (!Array.isArray(allowed) || !allowed.some((candidate) => jsonEquals(current, candidate))) {
          report('ENUM_MISMATCH', 'Value is not one of the allowed values');
        }
      }

      if (Object.hasOwn(schema, 'type')) {
        const expectedType = ownValue(schema, 'type');
        if (!schemaTypeMatches(expectedType, current)) {
          report('TYPE_MISMATCH', `Value must have type ${expectedTypeLabel(expectedType)}`);
          return false;
        }
      }

      if (typeof current === 'string') {
        const length = codePointLength(current);
        const minimumLength = ownValue(schema, 'minLength');
        const maximumLength = ownValue(schema, 'maxLength');
        if (typeof minimumLength === 'number' && length < minimumLength) {
          report('STRING_TOO_SHORT', 'String is shorter than the schema minimum');
        }
        if (typeof maximumLength === 'number' && length > maximumLength) {
          report('STRING_TOO_LONG', 'String is longer than the schema maximum');
        }
        const pattern = ownValue(schema, 'pattern');
        if (typeof pattern === 'string' && !new RegExp(pattern, 'u').test(current)) {
          report('PATTERN_MISMATCH', 'String does not match the required pattern');
        }
      }

      if (typeof current === 'number' && Number.isFinite(current)) {
        const minimum = ownValue(schema, 'minimum');
        const maximum = ownValue(schema, 'maximum');
        if (typeof minimum === 'number' && current < minimum) {
          report('NUMBER_BELOW_MINIMUM', 'Number is below the schema minimum');
        }
        if (typeof maximum === 'number' && current > maximum) {
          report('NUMBER_ABOVE_MAXIMUM', 'Number is above the schema maximum');
        }
      }

      if (Array.isArray(current)) {
        const maximumItems = ownValue(schema, 'maxItems');
        if (typeof maximumItems === 'number' && current.length > maximumItems) {
          report('ARRAY_TOO_LONG', 'Array contains more items than the schema maximum');
        }
        const itemSchema = ownValue(schema, 'items');
        if (isObject(itemSchema)) {
          const descriptors = Object.getOwnPropertyDescriptors(current);
          for (let index = 0; index < current.length; index += 1) {
            const descriptor = descriptors[String(index)];
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
              report('ARRAY_VALUE_UNSUPPORTED', 'Array items must be own data values', `${path}[${index}]`);
              continue;
            }
            if (!validateAgainstSchema(itemSchema, descriptor.value, `${path}[${index}]`, emitIssues)) {
              valid = false;
            }
            if (validationLimitRecorded) break;
          }
        }
      } else if (isObject(current)) {
        const keys = Object.keys(current).sort(codePointCompare);
        const maximumProperties = ownValue(schema, 'maxProperties');
        if (typeof maximumProperties === 'number' && keys.length > maximumProperties) {
          report('OBJECT_TOO_LARGE', 'Object contains more properties than the schema maximum');
        }

        const required = ownValue(schema, 'required');
        if (Array.isArray(required)) {
          for (const requiredKey of required) {
            if (typeof requiredKey === 'string' && !Object.hasOwn(current, requiredKey)) {
              report(
                'REQUIRED_PROPERTY_MISSING',
                'Required property is missing',
                appendPath(path, requiredKey),
              );
            }
          }
        }

        const propertiesValue = ownValue(schema, 'properties');
        const properties = isObject(propertiesValue) ? propertiesValue : null;
        const additionalProperties = ownValue(schema, 'additionalProperties');
        for (const key of keys) {
          const child = ownValue(current, key);
          const childPath = appendPath(path, key);
          if (properties !== null && Object.hasOwn(properties, key)) {
            const childSchema = ownValue(properties, key);
            if (isObject(childSchema)
              && !validateAgainstSchema(childSchema, child, childPath, emitIssues)) valid = false;
          } else if (additionalProperties === false) {
            report('ADDITIONAL_PROPERTY', 'Property is not allowed by the schema', childPath);
          } else if (isObject(additionalProperties)
            && !validateAgainstSchema(additionalProperties, child, childPath, emitIssues)) valid = false;
          if (validationLimitRecorded) break;
        }
      }

      return valid;
    };

    if (!isObject(value)) {
      addIssue('$', 'ENVELOPE_OBJECT_REQUIRED', 'Envelope must be an object');
      return Object.freeze(issues);
    }
    if (!Object.hasOwn(value, 'schema')) {
      addIssue('$.schema', 'ENVELOPE_SCHEMA_REQUIRED', 'Envelope schema is required');
      return Object.freeze(issues);
    }
    const schemaName = ownValue(value, 'schema');
    if (!isRegisteredEnvelopeSchema(schemaName)) {
      addIssue('$.schema', 'ENVELOPE_SCHEMA_UNREGISTERED', 'Envelope schema is not registered');
      return Object.freeze(issues);
    }
    const envelopeSchema = ownValue(definitions, schemaName);
    if (!isObject(envelopeSchema)) {
      addIssue('$.schema', 'ENVELOPE_SCHEMA_UNAVAILABLE', 'Registered envelope schema is unavailable');
      return Object.freeze(issues);
    }
    const schemaValid = validateAgainstSchema(envelopeSchema, value, '$', true);
    if (!numbersValid && schemaValid && issues.length === 0) {
      addIssue('$', 'NUMBER_SAFETY_VIOLATION', 'Envelope contains an unsafe number');
    }
    return Object.freeze(issues);
  };

  return Object.freeze({
    rawSha256: EDGE_PROTOCOL_V1_SCHEMA_SHA256,
    document,
    isRegisteredEnvelopeSchema,
    validateEnvelope,
  });
}
