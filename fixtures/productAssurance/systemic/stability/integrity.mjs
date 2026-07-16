/** Pure, domain-separated canonical content digests for bounded S8 evidence. */

const SHA256_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const CANONICAL_LIMITS = Object.freeze({
  depth: 64,
  nodes: 100_000,
  entriesPerContainer: 4_096,
  stringCodeUnits: 16_384,
  canonicalCodeUnits: 4_194_304,
});
const SNAPSHOT_SPARSE_ARRAY = Symbol('SNAPSHOT_SPARSE_ARRAY');

function plainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataKeys(value) {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw new TypeError('canonical evidence cannot contain symbol keys');
  const dataKeys = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (Array.isArray(value) && key === 'length') {
      if (descriptor?.value !== value.length || descriptor.enumerable !== false) {
        throw new TypeError('canonical evidence arrays require an ordinary length');
      }
      continue;
    }
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      throw new TypeError('canonical evidence requires enumerable data properties');
    }
    dataKeys.push(key);
  }
  return dataKeys;
}

function accountSnapshotUnits(state, count) {
  state.codeUnits += count;
  if (state.codeUnits > CANONICAL_LIMITS.canonicalCodeUnits) {
    throw new TypeError('canonical evidence snapshot exceeds bound');
  }
}

function snapshotJsonPlain(
  value,
  state = { stack: new Set(), nodes: 0, codeUnits: 0 },
  depth = 0,
) {
  state.nodes += 1;
  if (depth > CANONICAL_LIMITS.depth || state.nodes > CANONICAL_LIMITS.nodes) {
    throw new TypeError('canonical evidence exceeds structural bounds');
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > CANONICAL_LIMITS.stringCodeUnits) {
      throw new TypeError('canonical evidence string exceeds bound');
    }
    accountSnapshotUnits(state, value.length);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical evidence numbers must be finite');
    return value;
  }
  if (typeof value !== 'object') throw new TypeError('canonical evidence must be JSON-plain');
  if (state.stack.has(value)) throw new TypeError('canonical evidence must be acyclic');
  state.stack.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) {
      throw new TypeError('canonical evidence cannot contain symbol keys');
    }
    if (Array.isArray(value)) {
      const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
      const length = lengthDescriptor?.value;
      if (lengthDescriptor === undefined
        || !Object.hasOwn(lengthDescriptor, 'value')
        || lengthDescriptor.enumerable !== false
        || !Number.isSafeInteger(length)
        || length < 0
        || length > CANONICAL_LIMITS.entriesPerContainer) {
        throw new TypeError('canonical evidence arrays require an ordinary bounded length');
      }
      const elementKeys = keys.filter((key) => key !== 'length');
      if (elementKeys.length !== length) {
        throw SNAPSHOT_SPARSE_ARRAY;
      }
      const descriptors = new Map();
      for (const key of elementKeys) {
        if (!/^(0|[1-9][0-9]*)$/.test(key)) {
          throw SNAPSHOT_SPARSE_ARRAY;
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
          throw SNAPSHOT_SPARSE_ARRAY;
        }
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined
          || !Object.hasOwn(descriptor, 'value')
          || descriptor.enumerable !== true) {
          throw new TypeError('canonical evidence requires enumerable data properties');
        }
        descriptors.set(index, descriptor.value);
      }
      const output = new Array(length);
      for (let index = 0; index < length; index += 1) {
        if (!descriptors.has(index)) {
          throw SNAPSHOT_SPARSE_ARRAY;
        }
        output[index] = snapshotJsonPlain(descriptors.get(index), state, depth + 1);
      }
      return Object.freeze(output);
    }
    if (!plainRecord(value)) throw new TypeError('canonical evidence objects must be plain records');
    if (keys.length > CANONICAL_LIMITS.entriesPerContainer) {
      throw new TypeError('canonical evidence record exceeds bound');
    }
    const output = Object.create(null);
    for (const key of keys) {
      if (key.length > CANONICAL_LIMITS.stringCodeUnits) {
        throw new TypeError('canonical evidence record exceeds bound');
      }
      accountSnapshotUnits(state, key.length);
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.enumerable !== true) {
        throw new TypeError('canonical evidence requires enumerable data properties');
      }
      output[key] = snapshotJsonPlain(descriptor.value, state, depth + 1);
    }
    return Object.freeze(output);
  } finally {
    state.stack.delete(value);
  }
}

function canonicalJson(value, state = { stack: new Set(), nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (depth > CANONICAL_LIMITS.depth || state.nodes > CANONICAL_LIMITS.nodes) {
    throw new TypeError('canonical evidence exceeds structural bounds');
  }
  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (value.length > CANONICAL_LIMITS.stringCodeUnits) throw new TypeError('canonical evidence string exceeds bound');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical evidence numbers must be finite');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError('canonical evidence must be JSON-plain');
  if (state.stack.has(value)) throw new TypeError('canonical evidence must be acyclic');
  state.stack.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = ownDataKeys(value);
      if (value.length > CANONICAL_LIMITS.entriesPerContainer) throw new TypeError('canonical evidence array exceeds bound');
      if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
        throw new TypeError('canonical evidence arrays must be dense and property-free');
      }
      return `[${value.map((entry) => canonicalJson(entry, state, depth + 1)).join(',')}]`;
    }
    if (!plainRecord(value)) throw new TypeError('canonical evidence objects must be plain records');
    const keys = ownDataKeys(value).sort();
    if (keys.length > CANONICAL_LIMITS.entriesPerContainer
      || keys.some((key) => key.length > CANONICAL_LIMITS.stringCodeUnits)) {
      throw new TypeError('canonical evidence record exceeds bound');
    }
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], state, depth + 1)}`).join(',')}}`;
  } finally {
    state.stack.delete(value);
  }
}

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const paddingLength = (64 - ((bytes.length + 9) % 64)) % 64;
  const padded = new Uint8Array(bytes.length + 1 + paddingLength + 8);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const high = Math.floor(bitLength / 0x1_0000_0000);
  const low = bitLength >>> 0;
  const lengthOffset = padded.length - 8;
  padded[lengthOffset] = high >>> 24;
  padded[lengthOffset + 1] = high >>> 16;
  padded[lengthOffset + 2] = high >>> 8;
  padded[lengthOffset + 3] = high;
  padded[lengthOffset + 4] = low >>> 24;
  padded[lengthOffset + 5] = low >>> 16;
  padded[lengthOffset + 6] = low >>> 8;
  padded[lengthOffset + 7] = low;

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] = ((padded[wordOffset] << 24)
        | (padded[wordOffset + 1] << 16)
        | (padded[wordOffset + 2] << 8)
        | padded[wordOffset + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, '0')).join('');
}

export function canonicalEvidenceDigest(domain, value) {
  if (typeof domain !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(domain)) {
    throw new TypeError('digest domain must be a bounded canonical label');
  }
  const canonical = canonicalJson(captureCanonicalEvidence(value));
  if (canonical.length > CANONICAL_LIMITS.canonicalCodeUnits) {
    throw new TypeError('canonical evidence encoding exceeds bound');
  }
  return `sha256:${sha256Hex(`${domain}\n${canonical}`)}`;
}

/**
 * Captures one bounded descriptor-level snapshot without invoking accessors or
 * rereading caller-controlled properties. Proxy `get` traps cannot change the
 * captured values used by validation, evaluation, and retained source proof.
 */
export function captureCanonicalEvidence(value) {
  try {
    return snapshotJsonPlain(value);
  } catch (error) {
    if (error === SNAPSHOT_SPARSE_ARRAY) {
      throw new TypeError('canonical evidence arrays must be dense and property-free');
    }
    throw new TypeError('canonical evidence must be bounded, acyclic, and composed of enumerable JSON-plain data properties');
  }
}

export function cancellationRestartDigest(checkpointRef, protectedState) {
  return canonicalEvidenceDigest('ip-assurance.s8.cancellation.restart-checkpoint.v1', {
    checkpointRef,
    protectedState,
  });
}

export function repairRestartDigest({
  checkpointRef,
  campaignId,
  policyId,
  policyRevision,
  state,
  attempts,
}) {
  return canonicalEvidenceDigest('ip-assurance.s8.repair.restart-checkpoint.v1', {
    checkpointRef,
    campaignId,
    policyId,
    policyRevision,
    state,
    attempts,
  });
}
