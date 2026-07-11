export function exactConfigRecord(
  value: unknown,
  fields: readonly string[],
  name: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${name} cannot contain symbol keys`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(descriptors);
  if (names.length !== fields.length
    || names.some((field) => !fields.includes(field))
    || fields.some((field) => !Object.hasOwn(descriptors, field))) {
    throw new TypeError(`${name} contains unsupported or missing fields`);
  }
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${name}.${field} must be an enumerable data property`);
    }
    projected[field] = descriptor.value;
  }
  return Object.freeze(projected);
}
