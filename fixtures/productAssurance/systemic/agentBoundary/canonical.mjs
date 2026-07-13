import { createHash } from 'node:crypto';

const FORBIDDEN_KEY = /(?:apikey|apisecret|privatekey|signingkey|encryptionkey|clientsecret|authorizationheader|signedrequest)|^(?:secret|secrets|secretvalue|secretref|credential|credentials|password|passphrase|token|tokenvalue|accesstoken|refreshtoken|bearertoken|authtoken|sessiontoken|idtoken|servicetoken|rawprompt|rawevidence)$/i;

export function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertUtcMillis(value, field = 'nowMs') {
  if (!Number.isSafeInteger(value) || value < 1_262_304_000_000 || value > 4_102_444_800_000) {
    throw new TypeError(`${field} must be a safe UTC millisecond value`);
  }
  return value;
}

export function canonicalStringify(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical data cannot contain a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(',')}]`;
  }
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('canonical data must be JSON-plain and defined');
}

export function sha256Hex(value) {
  const encoded = typeof value === 'string' ? value : canonicalStringify(value);
  return createHash('sha256').update(encoded, 'utf8').digest('hex');
}

export function stableUnique(values) {
  return Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right)));
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function immutableClone(value) {
  return deepFreeze(JSON.parse(canonicalStringify(value)));
}

export function findForbiddenKeys(value, trail = '$') {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => hits.push(...findForbiddenKeys(entry, `${trail}[${index}]`)));
  } else if (isPlainRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key.replace(/[-_]/g, ''))) hits.push(`${trail}.${key}`);
      hits.push(...findForbiddenKeys(child, `${trail}.${key}`));
    }
  }
  return stableUnique(hits);
}

export function makeEvaluation({
  status,
  disposition,
  evaluatedAtMs,
  reasonCodes = [],
  evidenceRefs = [],
  allowed = false,
  extra = {},
}) {
  assertUtcMillis(evaluatedAtMs, 'evaluatedAtMs');
  if (!['PASS', 'FAIL', 'UNKNOWN'].includes(status)) throw new TypeError('invalid evaluation status');
  return immutableClone({
    schema: 'AgentBoundaryEvaluationV1',
    version: 1,
    status,
    disposition,
    allowed,
    productReadinessImpact: 'NONE',
    evaluatedAtMs,
    reasonCodes: stableUnique(reasonCodes),
    evidenceRefs: stableUnique(evidenceRefs),
    ...extra,
  });
}

export function appendChainDigest(receipt) {
  return sha256Hex({
    schema: receipt.schema,
    version: receipt.version,
    operation: receipt.operation,
    sequence: receipt.sequence,
    previousChainDigest: receipt.previousChainDigest,
    payloadDigest: receipt.payloadDigest,
    retainedAtMs: receipt.retainedAtMs,
    minimumRetainUntilMs: receipt.minimumRetainUntilMs,
    policyRevision: receipt.policyRevision,
    writerId: receipt.writerId,
    verifierId: receipt.verifierId,
    readbackState: receipt.readbackState,
  });
}
