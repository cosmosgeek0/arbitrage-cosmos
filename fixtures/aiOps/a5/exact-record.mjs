import {
  compareCodeUnits,
  isPlainRecord,
  sha256Hex as canonicalSha256Hex,
} from '../../productAssurance/systemic/agentBoundary/canonical.mjs';

const DEFAULT_LIMITS = Object.freeze({
  maxContainerEntries: 8_192,
  maxDepth: 64,
  maxNodes: 65_536,
  maxStringCodeUnits: 1_048_576,
});

function validatedLimit(value, fallback, label) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return selected;
}

/**
 * Descriptor-only, iterative validation for bounded JSON data. Accessors are
 * rejected without invocation; symbol/non-enumerable fields cannot disappear
 * at a canonical-hash boundary.
 */
export function strictJsonDataIssue(value, options = {}) {
  const maxContainerEntries = validatedLimit(
    options.maxContainerEntries,
    DEFAULT_LIMITS.maxContainerEntries,
    'maxContainerEntries',
  );
  const maxDepth = validatedLimit(options.maxDepth, DEFAULT_LIMITS.maxDepth, 'maxDepth');
  const maxNodes = validatedLimit(options.maxNodes, DEFAULT_LIMITS.maxNodes, 'maxNodes');
  const maxStringCodeUnits = validatedLimit(
    options.maxStringCodeUnits,
    DEFAULT_LIMITS.maxStringCodeUnits,
    'maxStringCodeUnits',
  );

  const ancestors = new WeakSet();
  const stack = [{ kind: 'ENTER', value, depth: 0 }];
  let nodeCount = 0;
  let stringCodeUnits = 0;

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame.kind === 'EXIT') {
      ancestors.delete(frame.value);
      continue;
    }

    const current = frame.value;
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'string') {
      stringCodeUnits += current.length;
      if (stringCodeUnits > maxStringCodeUnits) return 'STRING_CODE_UNIT_LIMIT_EXCEEDED';
      continue;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return 'NON_FINITE_NUMBER';
      if (Number.isInteger(current) && !Number.isSafeInteger(current)) return 'UNSAFE_INTEGER';
      continue;
    }
    if (typeof current !== 'object') return 'UNSUPPORTED_VALUE';
    if (frame.depth > maxDepth) return 'DEPTH_LIMIT_EXCEEDED';
    if (ancestors.has(current)) return 'CYCLIC_REFERENCE';

    nodeCount += 1;
    if (nodeCount > maxNodes) return 'NODE_LIMIT_EXCEEDED';
    ancestors.add(current);
    stack.push({ kind: 'EXIT', value: current });

    const ownKeys = Reflect.ownKeys(current);
    if (ownKeys.length > maxContainerEntries + (Array.isArray(current) ? 1 : 0)) {
      return 'CONTAINER_ENTRY_LIMIT_EXCEEDED';
    }
    if (ownKeys.some((key) => typeof key !== 'string')) return 'SYMBOL_KEY';
    const descriptors = Object.getOwnPropertyDescriptors(current);

    if (Array.isArray(current)) {
      const indexes = ownKeys.filter((key) => key !== 'length');
      if (indexes.length !== current.length
        || indexes.some((key, index) => key !== String(index))) return 'SPARSE_OR_EXTRA_ARRAY_KEY';
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || lengthDescriptor.enumerable
        || !Object.hasOwn(lengthDescriptor, 'value')) return 'INVALID_ARRAY_LENGTH_DESCRIPTOR';
      for (let index = indexes.length - 1; index >= 0; index -= 1) {
        const descriptor = descriptors[indexes[index]];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
          return Object.hasOwn(descriptor ?? {}, 'get') ? 'ACCESSOR_PROPERTY' : 'NON_ENUMERABLE_PROPERTY';
        }
        stack.push({ kind: 'ENTER', value: descriptor.value, depth: frame.depth + 1 });
      }
      continue;
    }

    if (!isPlainRecord(current)) return 'NON_PLAIN_RECORD';
    for (let index = ownKeys.length - 1; index >= 0; index -= 1) {
      const key = ownKeys[index];
      stringCodeUnits += key.length;
      if (stringCodeUnits > maxStringCodeUnits) return 'STRING_CODE_UNIT_LIMIT_EXCEEDED';
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return Object.hasOwn(descriptor ?? {}, 'get') ? 'ACCESSOR_PROPERTY' : 'NON_ENUMERABLE_PROPERTY';
      }
      stack.push({ kind: 'ENTER', value: descriptor.value, depth: frame.depth + 1 });
    }
  }

  return null;
}

export function strictSha256Hex(value, options) {
  const issue = strictJsonDataIssue(value, options);
  if (issue !== null) throw new TypeError(`strict canonical data invalid: ${issue}`);
  return canonicalSha256Hex(value);
}

// A5-only shape guard. Canonical encoding and hashing remain owned by the
// accepted Product Assurance agent-boundary fixture family.
export function hasExactKeys(value, expectedKeys, options) {
  if (!isPlainRecord(value) || strictJsonDataIssue(value, options) !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  const actual = ownKeys.sort(compareCodeUnits);
  const expected = [...expectedKeys].sort(compareCodeUnits);
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
