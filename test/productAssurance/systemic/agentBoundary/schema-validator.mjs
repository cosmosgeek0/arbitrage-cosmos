export function createSchemaValidator(schemaDocument) {
  function resolveRef(ref) {
    if (!ref.startsWith('#/')) throw new Error(`unsupported schema reference ${ref}`);
    let current = schemaDocument;
    for (const rawPart of ref.slice(2).split('/')) {
      const part = rawPart.replaceAll('~1', '/').replaceAll('~0', '~');
      current = current?.[part];
    }
    if (!current) throw new Error(`unresolved schema reference ${ref}`);
    return current;
  }

  function validate(schema, value, trail = '$') {
    if (schema.$ref) return validate(resolveRef(schema.$ref), value, trail);
    if (schema.anyOf) {
      const branches = schema.anyOf.map((branch) => validate(branch, value, trail));
      return branches.some((errors) => errors.length === 0) ? [] : [`${trail}: no anyOf branch matched`];
    }
    if (schema.oneOf) {
      const matched = schema.oneOf.filter((branch) => validate(branch, value, trail).length === 0).length;
      return matched === 1 ? [] : [`${trail}: expected exactly one oneOf match, got ${matched}`];
    }

    const errors = [];
    if (Object.hasOwn(schema, 'const') && value !== schema.const) errors.push(`${trail}: expected const ${JSON.stringify(schema.const)}`);
    if (schema.enum && !schema.enum.includes(value)) errors.push(`${trail}: value is not in enum`);
    if (schema.type) {
      const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) && schema.type === 'integer' ? 'integer' : typeof value;
      const typeMatches = schema.type === actual || (schema.type === 'number' && actual === 'integer');
      if (!typeMatches) return [...errors, `${trail}: expected ${schema.type}, got ${actual}`];
    }
    if (typeof value === 'string') {
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${trail}: pattern mismatch`);
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${trail}: shorter than minLength`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${trail}: longer than maxLength`);
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${trail}: below minimum`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${trail}: above maximum`);
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${trail}: too few items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${trail}: too many items`);
      if (schema.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) errors.push(`${trail}: duplicate items`);
      if (schema.items) value.forEach((entry, index) => errors.push(...validate(schema.items, entry, `${trail}[${index}]`)));
    } else if (value && typeof value === 'object') {
      for (const required of schema.required ?? []) {
        if (!Object.hasOwn(value, required)) errors.push(`${trail}: missing required ${required}`);
      }
      for (const [key, entry] of Object.entries(value)) {
        if (schema.properties && Object.hasOwn(schema.properties, key)) {
          errors.push(...validate(schema.properties[key], entry, `${trail}.${key}`));
        } else if (schema.additionalProperties === false) errors.push(`${trail}: unknown field ${key}`);
        else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          errors.push(...validate(schema.additionalProperties, entry, `${trail}.${key}`));
        }
      }
    }
    return errors;
  }

  return validate;
}
