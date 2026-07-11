const DEFAULT_LIMITS = Object.freeze({
  maximumBytes: 512 * 1024,
  maximumDepth: 24,
  maximumNodes: 50_000,
  maximumArrayLength: 2_000,
  maximumObjectKeys: 256,
  maximumStringBytes: 64 * 1024,
});

function positiveSafeInteger(value, fallback, label) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return selected;
}

export function fixtureJsonLimits(overrides = {}) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('fixture JSON limits must be an object');
  }
  return Object.freeze({
    maximumBytes: positiveSafeInteger(overrides.maximumBytes, DEFAULT_LIMITS.maximumBytes, 'maximumBytes'),
    maximumDepth: positiveSafeInteger(overrides.maximumDepth, DEFAULT_LIMITS.maximumDepth, 'maximumDepth'),
    maximumNodes: positiveSafeInteger(overrides.maximumNodes, DEFAULT_LIMITS.maximumNodes, 'maximumNodes'),
    maximumArrayLength: positiveSafeInteger(
      overrides.maximumArrayLength,
      DEFAULT_LIMITS.maximumArrayLength,
      'maximumArrayLength',
    ),
    maximumObjectKeys: positiveSafeInteger(
      overrides.maximumObjectKeys,
      DEFAULT_LIMITS.maximumObjectKeys,
      'maximumObjectKeys',
    ),
    maximumStringBytes: positiveSafeInteger(
      overrides.maximumStringBytes,
      DEFAULT_LIMITS.maximumStringBytes,
      'maximumStringBytes',
    ),
  });
}

function normalizeJson(value, limits, state, path, depth) {
  state.nodes += 1;
  if (state.nodes > limits.maximumNodes) {
    throw new RangeError(`fixture JSON exceeds maximumNodes at ${path}`);
  }
  if (depth > limits.maximumDepth) {
    throw new RangeError(`fixture JSON exceeds maximumDepth at ${path}`);
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`fixture JSON contains a non-finite number at ${path}`);
    return value;
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > limits.maximumStringBytes) {
      throw new RangeError(`fixture JSON string exceeds maximumStringBytes at ${path}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maximumArrayLength) {
      throw new RangeError(`fixture JSON array exceeds maximumArrayLength at ${path}`);
    }
    if (state.seen.has(value)) throw new TypeError(`fixture JSON contains a cycle at ${path}`);
    state.seen.add(value);
    try {
      const output = value.map((entry, index) => normalizeJson(entry, limits, state, `${path}[${index}]`, depth + 1));
      return Object.freeze(output);
    } finally {
      state.seen.delete(value);
    }
  }
  if (typeof value !== 'object') {
    throw new TypeError(`fixture JSON contains unsupported ${typeof value} at ${path}`);
  }
  if (state.seen.has(value)) throw new TypeError(`fixture JSON contains a cycle at ${path}`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`fixture JSON contains a non-plain object at ${path}`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`fixture JSON contains symbol keys at ${path}`);
  }
  const keys = Object.keys(value).sort();
  if (keys.length > limits.maximumObjectKeys) {
    throw new RangeError(`fixture JSON object exceeds maximumObjectKeys at ${path}`);
  }
  state.seen.add(value);
  const output = {};
  try {
    for (const key of keys) {
      if (Buffer.byteLength(key, 'utf8') > limits.maximumStringBytes) {
        throw new RangeError(`fixture JSON key exceeds maximumStringBytes at ${path}`);
      }
      output[key] = normalizeJson(value[key], limits, state, `${path}.${key}`, depth + 1);
    }
  } finally {
    state.seen.delete(value);
  }
  return Object.freeze(output);
}

export function cloneFrozenJson(value, options = {}) {
  const limits = fixtureJsonLimits(options);
  const normalized = normalizeJson(value, limits, { nodes: 0, seen: new Set() }, '$', 0);
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, 'utf8') > limits.maximumBytes) {
    throw new RangeError('fixture JSON exceeds maximumBytes');
  }
  return normalized;
}

export function canonicalFixtureJson(value, options = {}) {
  return JSON.stringify(cloneFrozenJson(value, options));
}

export function cloneFrozenNullable(value, options = {}) {
  return value === undefined ? null : cloneFrozenJson(value, options);
}
