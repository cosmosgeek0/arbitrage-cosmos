/**
 * Foundation contracts — diagnostic/replay envelope guard (WAVE 0, frozen).
 *
 * Every diagnostic or replay payload that leaves a foundation module rides
 * in a versioned DiagnosticEnvelope, and every envelope passes the secret
 * guard: keys matching the secret-like pattern are REJECTED with a named
 * failure. Nothing is silently stripped into fake success — a payload with
 * a secret in it does not get captured at all.
 *
 * Also enforces plain-data discipline: payloads must be JSON-plain
 * (no functions, class instances, bigints, NaN, cycles), so replay capture
 * is deterministic and lossless.
 *
 * Pure module: no I/O, no clocks (createdAt/nowMs are caller-supplied from
 * injected clocks), no env, no import-time side effects.
 */
import { isDataAuthority, type DataAuthority } from './authority.js';
import {
  createStructuredFailure,
  fail,
  ok,
  type ContractResult,
} from './failures.js';
import { isValidUtcMillis } from './time.js';

// ---------- shared health vocabulary (used by Lane H diagnostics) ----------

export const HEALTH_STATES = ['HEALTHY', 'DEGRADED', 'BLOCKED', 'FAILED', 'UNKNOWN'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export function isHealthState(value: unknown): value is HealthState {
  return typeof value === 'string' && (HEALTH_STATES as readonly string[]).includes(value);
}

// ---------- secret guard ----------

/**
 * The frozen default pattern from the sprint directive. Matched
 * case-insensitively against BOTH the raw key and the key with '-'/'_'
 * removed, so 'api-key', 'API_KEY', and 'apikey' are all caught.
 */
export const DEFAULT_SECRET_KEY_PATTERN =
  /secret|apiKey|api_key|passphrase|password|token|privateKey|signature|listenKey|credential/i;

export interface SecretGuardOptions {
  /** Additional key patterns to reject on top of the frozen default. */
  extraPatterns?: readonly RegExp[];
}

/** True when an object key smells like credential material. */
export function isSecretLikeKey(key: string, options?: SecretGuardOptions): boolean {
  if (typeof key !== 'string') throw new TypeError('isSecretLikeKey: key must be a string');
  const flattened = key.replace(/[-_]/g, '');
  if (DEFAULT_SECRET_KEY_PATTERN.test(key) || DEFAULT_SECRET_KEY_PATTERN.test(flattened)) {
    return true;
  }
  for (const pattern of options?.extraPatterns ?? []) {
    if (pattern.test(key) || pattern.test(flattened)) return true;
  }
  return false;
}

/**
 * Recursively find every secret-like key path in a value. Deterministic
 * (object keys visited in sorted order), cycle-safe, pure inspection —
 * never mutates or strips.
 */
export function findSecretLikePaths(value: unknown, options?: SecretGuardOptions): string[] {
  const hits: string[] = [];
  walkForSecrets(value, '$', new Set<object>(), hits, options);
  return hits;
}

function walkForSecrets(
  value: unknown,
  path: string,
  seen: Set<object>,
  hits: string[],
  options?: SecretGuardOptions,
): void {
  if (typeof value !== 'object' || value === null) return;
  if (seen.has(value)) return; // cycle: serializability check reports it
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkForSecrets(item, `${path}[${i}]`, seen, hits, options));
  } else {
    for (const key of Object.keys(value).sort()) {
      const childPath = `${path}.${key}`;
      if (isSecretLikeKey(key, options)) hits.push(childPath);
      walkForSecrets((value as Record<string, unknown>)[key], childPath, seen, hits, options);
    }
  }
  seen.delete(value);
}

// ---------- plain-data (serializability) check ----------

/** One reason a payload cannot be captured losslessly. */
export interface SerializabilityIssue {
  path: string;
  code: 'UNDEFINED_VALUE' | 'NON_FINITE_NUMBER' | 'UNSERIALIZABLE_TYPE' | 'NON_PLAIN_OBJECT' | 'CYCLIC_STRUCTURE';
}

/** Deterministic, cycle-safe plain-data validation. Empty array = clean. */
export function findSerializabilityIssues(value: unknown): SerializabilityIssue[] {
  const issues: SerializabilityIssue[] = [];
  walkForSerializability(value, '$', new Set<object>(), issues);
  return issues;
}

function walkForSerializability(
  value: unknown,
  path: string,
  seen: Set<object>,
  issues: SerializabilityIssue[],
): void {
  if (value === null) return;
  const t = typeof value;
  if (t === 'boolean' || t === 'string') return;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) issues.push({ path, code: 'NON_FINITE_NUMBER' });
    return;
  }
  if (t === 'undefined') {
    issues.push({ path, code: 'UNDEFINED_VALUE' });
    return;
  }
  if (t !== 'object') {
    issues.push({ path, code: 'UNSERIALIZABLE_TYPE' });
    return;
  }
  const obj = value as object;
  if (seen.has(obj)) {
    issues.push({ path, code: 'CYCLIC_STRUCTURE' });
    return;
  }
  seen.add(obj);
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => walkForSerializability(item, `${path}[${i}]`, seen, issues));
  } else {
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      issues.push({ path, code: 'NON_PLAIN_OBJECT' });
      seen.delete(obj);
      return;
    }
    for (const key of Object.keys(obj).sort()) {
      walkForSerializability((obj as Record<string, unknown>)[key], `${path}.${key}`, seen, issues);
    }
  }
  seen.delete(obj);
}

// ---------- diagnostic envelope ----------

export const ENVELOPE_VERSION = 1 as const;

export interface DiagnosticEnvelope<T = Readonly<Record<string, unknown>>> {
  envelopeVersion: typeof ENVELOPE_VERSION;
  /** What this envelope carries, e.g. 'control.statusSnapshot'. */
  kind: string;
  /** From the producer's injected clock. */
  createdAt: number;
  /** Authority of the facts inside the payload. */
  authority: DataAuthority;
  /** Correlation to the causing command/plan; null for ambient diagnostics. */
  correlationId: string | null;
  payload: T;
}

export interface EnvelopeInput<T> {
  kind: string;
  createdAt: number;
  authority: DataAuthority;
  correlationId: string | null;
  payload: T;
}

const COMPONENT = 'foundation.contracts.diagnostics';

function envelopeFailure(
  stage: string,
  code: string,
  message: string,
  nowMs: number,
  correlationId: string | null,
): ContractResult<never> {
  return fail(
    createStructuredFailure({
      component: COMPONENT,
      stage,
      code,
      message,
      occurredAt: nowMs,
      retryable: false,
      safeCurrentState: 'ENVELOPE_NOT_CAPTURED',
      recommendedOperatorAction:
        'Remove the offending fields from the diagnostic payload at the producer; secrets and non-plain data are never captured.',
      correlationId: correlationId ?? 'UNCORRELATED',
    }),
  );
}

/**
 * Build a guarded envelope. Deterministic; `nowMs` comes from the caller's
 * injected clock and is used only for failure timestamps.
 *
 * Rejection (named StructuredFailure, never silent stripping):
 *   - SECRET_FIELD_REJECTED       — any secret-like key anywhere in the
 *                                   envelope (kind included) or payload;
 *   - ENVELOPE_NOT_SERIALIZABLE   — non-plain data (undefined, NaN,
 *                                   functions, class instances, cycles);
 *   - ENVELOPE_FIELDS_INVALID     — malformed kind/createdAt/authority/
 *                                   correlationId.
 *
 * On success the payload is deep-cloned (validated plain data only) and the
 * whole envelope deep-frozen, so later mutation of the producer's object
 * cannot rewrite captured history.
 */
export function createDiagnosticEnvelope<T>(
  input: EnvelopeInput<T>,
  nowMs: number,
  options?: SecretGuardOptions,
): ContractResult<Readonly<DiagnosticEnvelope<T>>> {
  if (!isValidUtcMillis(nowMs)) {
    throw new TypeError('createDiagnosticEnvelope: nowMs must be a valid UTC ms from an injected clock');
  }
  const correlationId = typeof input.correlationId === 'string' ? input.correlationId : null;

  if (
    typeof input.kind !== 'string' ||
    input.kind.trim().length === 0 ||
    input.kind.length > 200 ||
    !isValidUtcMillis(input.createdAt) ||
    !isDataAuthority(input.authority) ||
    (input.correlationId !== null && (typeof input.correlationId !== 'string' || input.correlationId.length === 0))
  ) {
    return envelopeFailure(
      'validateFields',
      'ENVELOPE_FIELDS_INVALID',
      'envelope requires non-empty kind, valid createdAt, a DataAuthority, and correlationId string|null',
      nowMs,
      correlationId,
    );
  }

  const serializability = findSerializabilityIssues(input.payload);
  if (serializability.length > 0) {
    return envelopeFailure(
      'validatePayload',
      'ENVELOPE_NOT_SERIALIZABLE',
      `payload is not plain data: ${serializability.map((i) => `${i.path}:${i.code}`).join(', ')}`,
      nowMs,
      correlationId,
    );
  }

  const secretPaths = [
    ...(isSecretLikeKey(input.kind, options) ? ['$.kind'] : []),
    ...findSecretLikePaths(input.payload, options).map((p) => p.replace(/^\$/, '$.payload')),
  ];
  if (secretPaths.length > 0) {
    return envelopeFailure(
      'guardSecrets',
      'SECRET_FIELD_REJECTED',
      `secret-like fields rejected from diagnostic envelope: ${secretPaths.join(', ')}`,
      nowMs,
      correlationId,
    );
  }

  const envelope: DiagnosticEnvelope<T> = {
    envelopeVersion: ENVELOPE_VERSION,
    kind: input.kind,
    createdAt: input.createdAt,
    authority: input.authority,
    correlationId: input.correlationId,
    payload: deepCloneFrozen(input.payload) as T,
  };
  return ok(Object.freeze(envelope));
}

/**
 * Guard an already-shaped envelope (e.g. one restored from a replay store).
 * Same rejection semantics as createDiagnosticEnvelope; on success returns
 * a frozen deep clone.
 */
export function guardDiagnosticEnvelope<T>(
  envelope: DiagnosticEnvelope<T>,
  nowMs: number,
  options?: SecretGuardOptions,
): ContractResult<Readonly<DiagnosticEnvelope<T>>> {
  if (!isValidUtcMillis(nowMs)) {
    throw new TypeError('guardDiagnosticEnvelope: nowMs must be a valid UTC ms from an injected clock');
  }
  if (typeof envelope !== 'object' || envelope === null || envelope.envelopeVersion !== ENVELOPE_VERSION) {
    return envelopeFailure(
      'validateFields',
      'ENVELOPE_FIELDS_INVALID',
      `envelope must be a plain object with envelopeVersion ${ENVELOPE_VERSION}`,
      nowMs,
      null,
    );
  }
  return createDiagnosticEnvelope(
    {
      kind: envelope.kind,
      createdAt: envelope.createdAt,
      authority: envelope.authority,
      correlationId: envelope.correlationId,
      payload: envelope.payload,
    },
    nowMs,
    options,
  );
}

/** Deep clone of ALREADY-VALIDATED plain data, frozen at every level. */
function deepCloneFrozen(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepCloneFrozen(item)));
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    out[key] = deepCloneFrozen((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(out);
}
