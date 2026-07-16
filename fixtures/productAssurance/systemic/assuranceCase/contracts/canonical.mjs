export const MIN_UTC_MS = 1_262_304_000_000;
export const MAX_UTC_MS = 4_102_444_800_000;

const DEFAULT_CAPTURE_LIMITS = Object.freeze({
  maxDepth: 24,
  maxNodes: 20_000,
  maxArrayLength: 2_048,
  maxObjectKeys: 256,
  maxStringLength: 8_192,
});

export const isValidUtcMillis = (value) => (
  Number.isSafeInteger(value) && value >= MIN_UTC_MS && value <= MAX_UTC_MS
);

export const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

export const canonicalStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const compareCanonical = (left, right) => {
  const leftText = String(left);
  const rightText = String(right);
  if (leftText < rightText) return -1;
  if (leftText > rightText) return 1;
  return 0;
};

export const stableUnique = (values) => Object.freeze(
  [...new Set(values)].sort(compareCanonical),
);

const captureFailure = (path, code, message) => ({
  ok: false,
  value: null,
  issues: [{ path, code, message }],
});

/**
 * Captures a bounded plain-data image without reading through ordinary getters.
 * Hostile proxies may still trap reflection; every reflective operation is caught and
 * converted to a bounded issue rather than escaping across the packet boundary.
 */
export function capturePlainData(input, requestedLimits = {}) {
  const limits = { ...DEFAULT_CAPTURE_LIMITS, ...requestedLimits };
  const seen = new WeakSet();
  let nodes = 0;

  const visit = (value, path, depth) => {
    nodes += 1;
    if (nodes > limits.maxNodes) throw new CaptureError(path, 'CAPTURE_NODE_LIMIT', 'plain-data capture exceeds the node budget');
    if (depth > limits.maxDepth) throw new CaptureError(path, 'CAPTURE_DEPTH_LIMIT', 'plain-data capture exceeds the depth budget');

    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.length > limits.maxStringLength) throw new CaptureError(path, 'CAPTURE_STRING_LIMIT', 'string exceeds the capture budget');
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) throw new CaptureError(path, 'CAPTURE_NUMBER_INVALID', 'numbers must be safe integers');
      return value;
    }
    if (typeof value !== 'object') throw new CaptureError(path, 'PLAIN_DATA_REQUIRED', `unsupported ${typeof value} value`);
    if (seen.has(value)) throw new CaptureError(path, 'PLAIN_DATA_CYCLE', 'cyclic values are not allowed');
    seen.add(value);

    let prototype;
    let descriptors;
    let symbols;
    try {
      prototype = Object.getPrototypeOf(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
      symbols = Object.getOwnPropertySymbols(value);
    } catch {
      throw new CaptureError(path, 'PLAIN_DATA_REFLECTION_FAILED', 'value cannot be safely reflected');
    }
    if (symbols.length > 0) throw new CaptureError(path, 'PLAIN_DATA_SYMBOL_KEY', 'symbol keys are not allowed');

    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) throw new CaptureError(path, 'PLAIN_ARRAY_REQUIRED', 'array subclasses are not allowed');
      if (value.length > limits.maxArrayLength) throw new CaptureError(path, 'CAPTURE_ARRAY_LIMIT', 'array exceeds the capture budget');
      const allowedKeys = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
      for (const key of Object.keys(descriptors)) {
        if (!allowedKeys.has(key)) throw new CaptureError(`${path}.${key}`, 'PLAIN_ARRAY_EXTRA_KEY', 'array has an unexpected own key');
      }
      const output = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor) throw new CaptureError(`${path}[${index}]`, 'PLAIN_ARRAY_SPARSE', 'sparse arrays are not allowed');
        if (!Object.hasOwn(descriptor, 'value')) throw new CaptureError(`${path}[${index}]`, 'PLAIN_DATA_ACCESSOR', 'accessor properties are not allowed');
        output.push(visit(descriptor.value, `${path}[${index}]`, depth + 1));
      }
      seen.delete(value);
      return output;
    }

    if (prototype !== Object.prototype && prototype !== null) {
      throw new CaptureError(path, 'PLAIN_OBJECT_REQUIRED', 'objects must use Object.prototype or null');
    }
    const keys = Object.keys(descriptors);
    if (keys.length > limits.maxObjectKeys) throw new CaptureError(path, 'CAPTURE_OBJECT_KEY_LIMIT', 'object exceeds the key budget');
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) throw new CaptureError(`${path}.${key}`, 'PLAIN_DATA_NON_ENUMERABLE', 'non-enumerable fields are not allowed');
      if (!Object.hasOwn(descriptor, 'value')) throw new CaptureError(`${path}.${key}`, 'PLAIN_DATA_ACCESSOR', 'accessor properties are not allowed');
      Object.defineProperty(output, key, {
        value: visit(descriptor.value, `${path}.${key}`, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    seen.delete(value);
    return output;
  };

  try {
    return { ok: true, value: visit(input, '$', 0), issues: [] };
  } catch (error) {
    if (error instanceof CaptureError) return captureFailure(error.path, error.code, error.message);
    return captureFailure('$', 'PLAIN_DATA_CAPTURE_FAILED', 'plain-data capture failed');
  }
}

class CaptureError extends Error {
  constructor(path, code, message) {
    super(message);
    this.name = 'CaptureError';
    this.path = path;
    this.code = code;
  }
}

export const clonePlainData = (value) => {
  const captured = capturePlainData(value);
  if (!captured.ok) throw new TypeError(captured.issues[0].code);
  return captured.value;
};
