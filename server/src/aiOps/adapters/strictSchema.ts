import { isPlainRecord, type JsonValue } from './contracts.js';

interface StringSchema {
  readonly type: 'string';
  readonly enum?: readonly string[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

interface IntegerSchema {
  readonly type: 'integer';
  readonly minimum?: number;
  readonly maximum?: number;
}

interface BooleanSchema {
  readonly type: 'boolean';
}

interface NullSchema {
  readonly type: 'null';
}

interface ArraySchema {
  readonly type: 'array';
  readonly items: StrictSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
}

export interface ObjectSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, StrictSchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export type StrictSchema = StringSchema | IntegerSchema | BooleanSchema | NullSchema | ArraySchema | ObjectSchema;

export interface SchemaValidationResult {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SCHEMA_TYPES = new Set(['string', 'integer', 'boolean', 'null', 'array', 'object']);
const ALLOWED_STRING_PATTERNS = new Set([
  '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',
  '^[a-f0-9]{64}$',
  '^(?:[a-f0-9]{40}|[a-f0-9]{64})$',
  '^(?:server/src/aiOps/adapters|fixtures/aiOps/a3|server/test/aiOps/a3)/(?:[A-Za-z0-9][A-Za-z0-9._-]*/)*[A-Za-z0-9][A-Za-z0-9._-]*$',
]);

function unknownKeys(record: Record<string, unknown>, allowed: readonly string[], path: string): string[] {
  const allowedSet = new Set(allowed);
  return Object.keys(record).filter((key) => !allowedSet.has(key)).map((key) => `${path}.${key}:UNKNOWN_SCHEMA_KEYWORD`);
}

function validOptionalBound(value: unknown): boolean {
  return value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function schemaDefinitionIssues(schema: unknown, path: string, depth: number): string[] {
  if (depth > 24) return [`${path}:SCHEMA_DEPTH_EXCEEDED`];
  if (!isPlainRecord(schema)) return [`${path}:SCHEMA_MUST_BE_PLAIN_OBJECT`];
  if (Object.getOwnPropertySymbols(schema).length > 0) return [`${path}:SCHEMA_SYMBOL_PROPERTY_FORBIDDEN`];
  if (typeof schema.type !== 'string' || !SCHEMA_TYPES.has(schema.type)) return [`${path}:SCHEMA_TYPE_UNSUPPORTED`];
  const issues: string[] = [];

  if (schema.type === 'string') {
    issues.push(...unknownKeys(schema, ['type', 'enum', 'minLength', 'maxLength', 'pattern'], path));
    if (!validOptionalBound(schema.minLength) || !validOptionalBound(schema.maxLength)) issues.push(`${path}:STRING_BOUND_INVALID`);
    if (
      typeof schema.minLength === 'number'
      && typeof schema.maxLength === 'number'
      && schema.maxLength < schema.minLength
    ) issues.push(`${path}:STRING_BOUND_ORDER_INVALID`);
    if (schema.enum !== undefined) {
      if (!Array.isArray(schema.enum) || schema.enum.length === 0 || !schema.enum.every((value) => typeof value === 'string')) {
        issues.push(`${path}:STRING_ENUM_INVALID`);
      } else if (new Set(schema.enum).size !== schema.enum.length) issues.push(`${path}:STRING_ENUM_DUPLICATE`);
    }
    if (schema.pattern !== undefined) {
      if (typeof schema.pattern !== 'string' || !ALLOWED_STRING_PATTERNS.has(schema.pattern)) {
        issues.push(`${path}:PATTERN_NOT_CANONICALLY_ALLOWED`);
      }
    }
    return issues;
  }

  if (schema.type === 'integer') {
    issues.push(...unknownKeys(schema, ['type', 'minimum', 'maximum'], path));
    if (
      (schema.minimum !== undefined && !Number.isSafeInteger(schema.minimum))
      || (schema.maximum !== undefined && !Number.isSafeInteger(schema.maximum))
    ) issues.push(`${path}:INTEGER_BOUND_INVALID`);
    if (typeof schema.minimum === 'number' && typeof schema.maximum === 'number' && schema.maximum < schema.minimum) {
      issues.push(`${path}:INTEGER_BOUND_ORDER_INVALID`);
    }
    return issues;
  }

  if (schema.type === 'boolean' || schema.type === 'null') {
    issues.push(...unknownKeys(schema, ['type'], path));
    return issues;
  }

  if (schema.type === 'array') {
    issues.push(...unknownKeys(schema, ['type', 'items', 'minItems', 'maxItems', 'uniqueItems'], path));
    if (!Object.prototype.hasOwnProperty.call(schema, 'items')) issues.push(`${path}:ARRAY_ITEMS_MISSING`);
    else issues.push(...schemaDefinitionIssues(schema.items, `${path}.items`, depth + 1));
    if (!validOptionalBound(schema.minItems) || !validOptionalBound(schema.maxItems)) issues.push(`${path}:ARRAY_BOUND_INVALID`);
    if (typeof schema.minItems === 'number' && typeof schema.maxItems === 'number' && schema.maxItems < schema.minItems) {
      issues.push(`${path}:ARRAY_BOUND_ORDER_INVALID`);
    }
    if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean') issues.push(`${path}:ARRAY_UNIQUE_FLAG_INVALID`);
    return issues;
  }

  issues.push(...unknownKeys(schema, ['type', 'properties', 'required', 'additionalProperties'], path));
  if (!isPlainRecord(schema.properties)) return [...issues, `${path}:OBJECT_PROPERTIES_INVALID`];
  if (!Array.isArray(schema.required) || !schema.required.every((value) => typeof value === 'string')) {
    return [...issues, `${path}:OBJECT_REQUIRED_INVALID`];
  }
  const keys = Object.keys(schema.properties).sort((left, right) => left.localeCompare(right));
  const required = [...schema.required].sort((left, right) => left.localeCompare(right));
  if (schema.additionalProperties !== false) issues.push(`${path}:ADDITIONAL_PROPERTIES_NOT_FALSE`);
  if (new Set(required).size !== required.length) issues.push(`${path}:DUPLICATE_REQUIRED_KEY`);
  if (keys.join('\u0000') !== required.join('\u0000')) issues.push(`${path}:ALL_PROPERTIES_MUST_BE_REQUIRED`);
  for (const key of keys) {
    if (UNSAFE_KEYS.has(key)) issues.push(`${path}.${key}:UNSAFE_PROPERTY_NAME`);
    issues.push(...schemaDefinitionIssues(schema.properties[key], `${path}.${key}`, depth + 1));
  }
  return issues;
}

function valueIssues(schema: Readonly<StrictSchema>, value: unknown, path: string, depth: number): string[] {
  if (depth > 24) return [`${path}:VALUE_DEPTH_EXCEEDED`];
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') return [`${path}:EXPECTED_STRING`];
      const issues: string[] = [];
      if (schema.minLength !== undefined && value.length < schema.minLength) issues.push(`${path}:STRING_TOO_SHORT`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push(`${path}:STRING_TOO_LONG`);
      if (schema.enum !== undefined && !schema.enum.includes(value)) issues.push(`${path}:ENUM_MISMATCH`);
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) issues.push(`${path}:PATTERN_MISMATCH`);
      return issues;
    }
    case 'integer': {
      if (!Number.isSafeInteger(value)) return [`${path}:EXPECTED_SAFE_INTEGER`];
      const numberValue = value as number;
      const issues: string[] = [];
      if (schema.minimum !== undefined && numberValue < schema.minimum) issues.push(`${path}:INTEGER_BELOW_MINIMUM`);
      if (schema.maximum !== undefined && numberValue > schema.maximum) issues.push(`${path}:INTEGER_ABOVE_MAXIMUM`);
      return issues;
    }
    case 'boolean':
      return typeof value === 'boolean' ? [] : [`${path}:EXPECTED_BOOLEAN`];
    case 'null':
      return value === null ? [] : [`${path}:EXPECTED_NULL`];
    case 'array': {
      if (!Array.isArray(value)) return [`${path}:EXPECTED_ARRAY`];
      const issues: string[] = [];
      let items: unknown[];
      try {
        const preliminaryLengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
        if (preliminaryLengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(preliminaryLengthDescriptor, 'value')) {
          return [`${path}:ARRAY_LENGTH_DESCRIPTOR_INVALID`];
        }
        const preliminaryLength = preliminaryLengthDescriptor.value;
        const hardMaximum = schema.maxItems ?? 4_096;
        if (!Number.isSafeInteger(preliminaryLength) || preliminaryLength < 0 || preliminaryLength > hardMaximum) return [`${path}:ARRAY_TOO_LONG`];
        const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
        const lengthDescriptor = descriptors['length'];
        if (lengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')) {
          return [`${path}:ARRAY_LENGTH_DESCRIPTOR_INVALID`];
        }
        const length = lengthDescriptor.value;
        if (length !== preliminaryLength) return [`${path}:ARRAY_LENGTH_CHANGED`];
        if (schema.minItems !== undefined && length < schema.minItems) issues.push(`${path}:ARRAY_TOO_SHORT`);
        if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(descriptors).length !== length + 1) {
          return [`${path}:ARRAY_EXTRA_PROPERTY_FORBIDDEN`];
        }
        items = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return [`${path}:ARRAY_ACCESSOR_OR_HOLE_FORBIDDEN`];
          items.push(descriptor.value);
        }
      } catch {
        return [`${path}:ARRAY_DESCRIPTOR_REJECTED`];
      }
      items.forEach((item, index) => issues.push(...valueIssues(schema.items, item, `${path}[${index}]`, depth + 1)));
      if (schema.uniqueItems === true && issues.length === 0) {
        try {
          const serialized = items.map((item) => JSON.stringify(item));
          if (serialized.some((item) => item === undefined)) issues.push(`${path}:ARRAY_ITEM_NOT_JSON`);
          else if (new Set(serialized).size !== serialized.length) issues.push(`${path}:ARRAY_ITEMS_NOT_UNIQUE`);
        } catch {
          issues.push(`${path}:ARRAY_ITEM_NOT_JSON`);
        }
      }
      return issues;
    }
    case 'object': {
      if (!isPlainRecord(value)) return [`${path}:EXPECTED_PLAIN_OBJECT`];
      let descriptors: Record<string, PropertyDescriptor>;
      try {
        descriptors = Object.getOwnPropertyDescriptors(value);
      } catch {
        return [`${path}:OBJECT_DESCRIPTOR_REJECTED`];
      }
      const keys = Object.keys(descriptors);
      const allowed = new Set(Object.keys(schema.properties));
      const issues: string[] = [];
      if (keys.length > allowed.size) return [`${path}:OBJECT_PROPERTY_COUNT_EXCEEDED`];
      if (Object.getOwnPropertySymbols(value).length > 0) issues.push(`${path}:SYMBOL_PROPERTY_FORBIDDEN`);
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(descriptors[key], 'value')) issues.push(`${path}.${key}:ACCESSOR_PROPERTY_FORBIDDEN`);
        if (UNSAFE_KEYS.has(key)) issues.push(`${path}.${key}:UNSAFE_PROPERTY_NAME`);
        else if (!allowed.has(key)) issues.push(`${path}.${key}:UNEXPECTED_PROPERTY`);
      }
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) issues.push(`${path}.${key}:REQUIRED_PROPERTY_MISSING`);
      }
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        const descriptor = descriptors[key];
        if (descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          issues.push(...valueIssues(childSchema, descriptor.value, `${path}.${key}`, depth + 1));
        }
      }
      return issues;
    }
  }
}

export interface StrictDataSnapshot {
  readonly ok: boolean;
  readonly value: unknown;
}

function snapshotStrictDataValueInternal(
  value: unknown,
  depth: number,
  state: { nodes: number },
  seen: WeakSet<object>,
): StrictDataSnapshot {
  try {
    if (depth > 24 || state.nodes >= 4_096) return { ok: false, value: null };
    state.nodes += 1;
    if (value === null || typeof value !== 'object') return { ok: true, value };
    if (seen.has(value)) return { ok: false, value: null };
    seen.add(value);
    if (Array.isArray(value)) {
      const preliminaryLengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (preliminaryLengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(preliminaryLengthDescriptor, 'value')) {
        return { ok: false, value: null };
      }
      const preliminaryLength = preliminaryLengthDescriptor.value;
      if (!Number.isSafeInteger(preliminaryLength) || preliminaryLength < 0 || preliminaryLength > 4_096) return { ok: false, value: null };
      const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
      const descriptorKeys = Reflect.ownKeys(descriptors);
      const lengthDescriptor = descriptors['length'];
      if (
        lengthDescriptor === undefined
        || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
        || lengthDescriptor.value !== preliminaryLength
        || descriptorKeys.some((key) => typeof key === 'symbol')
        || descriptorKeys.length !== preliminaryLength + 1
      ) return { ok: false, value: null };
      const snapshot: unknown[] = [];
      for (let index = 0; index < preliminaryLength; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return { ok: false, value: null };
        const child = snapshotStrictDataValueInternal(descriptor.value, depth + 1, state, seen);
        if (!child.ok) return { ok: false, value: null };
        snapshot.push(child.value);
      }
      seen.delete(value);
      return { ok: true, value: Object.freeze(snapshot) };
    }
    if (!isPlainRecord(value)) return { ok: false, value: null };
    const preliminaryKeys = Reflect.ownKeys(value);
    if (preliminaryKeys.length > 4_096 || preliminaryKeys.some((key) => typeof key === 'symbol')) return { ok: false, value: null };
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
    const descriptorKeys = Reflect.ownKeys(descriptors);
    const preliminaryNames = (preliminaryKeys as string[]).sort().join('\u0000');
    const descriptorNames = (descriptorKeys as string[]).sort().join('\u0000');
    if (preliminaryNames !== descriptorNames) return { ok: false, value: null };
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of descriptorKeys as string[]) {
      if (UNSAFE_KEYS.has(key)) return { ok: false, value: null };
      const descriptor = descriptors[key];
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return { ok: false, value: null };
      const child = snapshotStrictDataValueInternal(descriptor.value, depth + 1, state, seen);
      if (!child.ok) return { ok: false, value: null };
      snapshot[key] = child.value;
    }
    seen.delete(value);
    return { ok: true, value: Object.freeze(snapshot) };
  } catch {
    return { ok: false, value: null };
  }
}

export function snapshotStrictDataValue(value: unknown): StrictDataSnapshot {
  return snapshotStrictDataValueInternal(value, 0, { nodes: 0 }, new WeakSet<object>());
}

function snapshotValueForSchemaInternal(
  schema: Readonly<StrictSchema>,
  value: unknown,
  depth: number,
  state: { nodes: number },
  seen: WeakSet<object>,
): StrictDataSnapshot {
  try {
    if (depth > 24 || state.nodes >= 4_096) return { ok: false, value: null };
    state.nodes += 1;
    if (schema.type === 'array' && Array.isArray(value)) {
      if (seen.has(value)) return { ok: false, value: null };
      seen.add(value);
      const preliminaryLengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (preliminaryLengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(preliminaryLengthDescriptor, 'value')) {
        return { ok: false, value: null };
      }
      const length = preliminaryLengthDescriptor.value;
      const maximum = schema.maxItems ?? 4_096;
      if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return { ok: false, value: null };
      const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
      const descriptorKeys = Reflect.ownKeys(descriptors);
      const finalLengthDescriptor = descriptors['length'];
      if (
        finalLengthDescriptor === undefined
        || !Object.prototype.hasOwnProperty.call(finalLengthDescriptor, 'value')
        || finalLengthDescriptor.value !== length
        || descriptorKeys.some((key) => typeof key === 'symbol')
        || descriptorKeys.length !== length + 1
      ) return { ok: false, value: null };
      const snapshot: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return { ok: false, value: null };
        const child = snapshotValueForSchemaInternal(schema.items, descriptor.value, depth + 1, state, seen);
        if (!child.ok) return { ok: false, value: null };
        snapshot.push(child.value);
      }
      seen.delete(value);
      return { ok: true, value: Object.freeze(snapshot) };
    }
    if (schema.type === 'object' && isPlainRecord(value)) {
      if (seen.has(value)) return { ok: false, value: null };
      seen.add(value);
      const preliminaryKeys = Reflect.ownKeys(value);
      const maximum = Object.keys(schema.properties).length;
      if (preliminaryKeys.length > maximum || preliminaryKeys.some((key) => typeof key === 'symbol')) return { ok: false, value: null };
      const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
      const descriptorKeys = Reflect.ownKeys(descriptors);
      if ((preliminaryKeys as string[]).sort().join('\u0000') !== (descriptorKeys as string[]).sort().join('\u0000')) {
        return { ok: false, value: null };
      }
      const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of descriptorKeys as string[]) {
        if (UNSAFE_KEYS.has(key)) return { ok: false, value: null };
        const descriptor = descriptors[key];
        if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return { ok: false, value: null };
        const childSchema = schema.properties[key];
        if (childSchema === undefined) {
          snapshot[key] = null;
          continue;
        }
        const child = snapshotValueForSchemaInternal(childSchema, descriptor.value, depth + 1, state, seen);
        if (!child.ok) return { ok: false, value: null };
        snapshot[key] = child.value;
      }
      seen.delete(value);
      return { ok: true, value: Object.freeze(snapshot) };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, value: null };
  }
}

export function snapshotStrictValueForSchema(schema: Readonly<StrictSchema>, value: unknown): StrictDataSnapshot {
  return snapshotValueForSchemaInternal(schema, value, 0, { nodes: 0 }, new WeakSet<object>());
}

export function normalizeStrictSchemaDefinition(schema: unknown): Readonly<StrictSchema> | null {
  const snapshot = snapshotStrictDataValue(schema);
  if (!snapshot.ok) return null;
  const issues = schemaDefinitionIssues(snapshot.value, '$schema', 0);
  return issues.length === 0 ? snapshot.value as Readonly<StrictSchema> : null;
}

export function strictObject(properties: Readonly<Record<string, StrictSchema>>): Readonly<ObjectSchema> {
  const keys = Object.keys(properties).sort((left, right) => left.localeCompare(right));
  return Object.freeze({
    type: 'object',
    properties: Object.freeze({ ...properties }),
    required: Object.freeze(keys),
    additionalProperties: false,
  });
}

export function validateStrictSchemaDefinition(schema: Readonly<StrictSchema> | unknown): Readonly<SchemaValidationResult> {
  let issues: string[];
  try {
    const snapshot = snapshotStrictDataValue(schema);
    issues = snapshot.ok ? schemaDefinitionIssues(snapshot.value, '$schema', 0) : ['$schema:SCHEMA_ACCESS_REJECTED'];
  } catch {
    issues = ['$schema:SCHEMA_ACCESS_REJECTED'];
  }
  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues) });
}

export function validateStrictValue(schema: Readonly<StrictSchema>, value: unknown): Readonly<SchemaValidationResult> {
  const normalizedSchema = normalizeStrictSchemaDefinition(schema);
  if (normalizedSchema === null) {
    return Object.freeze({ valid: false, issues: Object.freeze(['$schema:SCHEMA_ACCESS_REJECTED']) });
  }
  const normalizedValue = snapshotStrictValueForSchema(normalizedSchema, value);
  if (!normalizedValue.ok) {
    return Object.freeze({ valid: false, issues: Object.freeze(['$:VALUE_ACCESS_REJECTED']) });
  }
  let issues: string[];
  try {
    issues = valueIssues(normalizedSchema, normalizedValue.value, '$', 0);
  } catch {
    issues = ['$:VALUE_ACCESS_REJECTED'];
  }
  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues) });
}

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  try {
    if (depth > 24) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) {
      if (value.length > 4_096 || Object.getOwnPropertySymbols(value).length > 0) return false;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.keys(descriptors).length !== value.length + 1) return false;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || !isJsonValue(descriptor.value, depth + 1)) return false;
      }
      return true;
    }
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).length > 4_096) return false;
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (UNSAFE_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || !isJsonValue(descriptor.value, depth + 1)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
