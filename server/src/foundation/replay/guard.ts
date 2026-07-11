/** Bounded, cycle-safe, secret-aware validation for replay payloads. */
import {
  canonicalJson,
  createDiagnosticEnvelope,
  isSecretLikeKey,
  type ContractResult,
  type ValidationIssue,
} from '../contracts/index.js';
import { replayFailure, REPLAY_FAILURE_CODES } from './failures.js';
import {
  MAX_REPLAY_ARRAY_LENGTH,
  MAX_REPLAY_OBJECT_KEYS,
  MAX_REPLAY_PAYLOAD_BYTES,
  MAX_REPLAY_PAYLOAD_DEPTH,
  MAX_REPLAY_PAYLOAD_NODES,
  MAX_REPLAY_STRING_LENGTH,
  MAX_REPLAY_VALIDATION_ISSUES,
  type ReplayJsonValue,
} from './types.js';

/** Private transport/account identifiers are rejected in addition to secrets. */
export const PRIVATE_PAYLOAD_KEY_PATTERN =
  /authorization|cookie|session|bearer|privatePayload|rawPrivate|accountNumber|emailAddress|ipAddress|withdrawalAddress/i;

const DANGEROUS_PROPERTY_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const PRIVATE_NORMALIZED_TERMS = [
  'secret',
  'apikey',
  'passphrase',
  'password',
  'token',
  'privatekey',
  'signature',
  'listenkey',
  'credential',
  'authorization',
  'cookie',
  'session',
  'bearer',
  'accountnumber',
  'emailaddress',
  'ipaddress',
  'withdrawaladdress',
  'rawprivate',
] as const;

function decodePercentOnce(value: string): string | null {
  if (!value.includes('%')) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function decodeBase64Ascii(value: string): string | null {
  if (value.length < 4 || value.length > 200 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return null;
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let i = 0; i < value.length; i += 4) {
    const a = alphabet.indexOf(value[i]);
    const b = alphabet.indexOf(value[i + 1]);
    const c = value[i + 2] === '=' ? 0 : alphabet.indexOf(value[i + 2]);
    const d = value[i + 3] === '=' ? 0 : alphabet.indexOf(value[i + 3]);
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;
    const bytes = [(a << 2) | (b >> 4)];
    if (value[i + 2] !== '=') bytes.push(((b & 15) << 4) | (c >> 2));
    if (value[i + 3] !== '=') bytes.push(((c & 3) << 6) | d);
    for (const byte of bytes) {
      if (byte < 0x20 || byte > 0x7e) return null;
      output += String.fromCharCode(byte);
    }
  }
  return output;
}

export function isReplaySecretLikeKey(key: string): boolean {
  if (typeof key !== 'string') return false;
  const candidates = new Set<string>([key]);
  const percentDecoded = decodePercentOnce(key);
  if (percentDecoded !== null) candidates.add(percentDecoded);
  for (const candidate of [...candidates]) {
    const base64Decoded = decodeBase64Ascii(candidate);
    if (base64Decoded !== null) candidates.add(base64Decoded);
  }
  for (const candidate of candidates) {
    if (isSecretLikeKey(candidate, { extraPatterns: [PRIVATE_PAYLOAD_KEY_PATTERN] })) return true;
    const normalized = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (PRIVATE_NORMALIZED_TERMS.some((term) => normalized.includes(term))) return true;
  }
  return false;
}

function isCredentialLikeString(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^Bearer\s+[A-Za-z0-9._~+/=-]{8,}$/i.test(trimmed) ||
    /^eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}$/.test(trimmed) ||
    /^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(trimmed)
  );
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function addIssue(issues: ValidationIssue[], issue: ValidationIssue): void {
  if (issues.length < MAX_REPLAY_VALIDATION_ISSUES) issues.push(issue);
}

/**
 * Structural resource guard. It intentionally runs before recursive contract
 * helpers so hostile depth, breadth, sparse arrays, and cycles are bounded.
 */
export function validateReplayPlainData(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ancestors = new Set<object>();
  let nodes = 0;

  const visit = (current: unknown, path: string, depth: number): void => {
    if (issues.length >= MAX_REPLAY_VALIDATION_ISSUES) return;
    nodes += 1;
    if (nodes > MAX_REPLAY_PAYLOAD_NODES) {
      addIssue(issues, {
        path,
        code: 'PAYLOAD_NODE_LIMIT_EXCEEDED',
        message: `payload exceeds ${MAX_REPLAY_PAYLOAD_NODES} nodes`,
      });
      return;
    }
    if (depth > MAX_REPLAY_PAYLOAD_DEPTH) {
      addIssue(issues, {
        path,
        code: 'PAYLOAD_DEPTH_EXCEEDED',
        message: `payload exceeds depth ${MAX_REPLAY_PAYLOAD_DEPTH}`,
      });
      return;
    }
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {
      if (current.length > MAX_REPLAY_STRING_LENGTH) {
        addIssue(issues, {
          path,
          code: 'STRING_TOO_LONG',
          message: `string exceeds ${MAX_REPLAY_STRING_LENGTH} UTF-16 code units`,
        });
      }
      if (isCredentialLikeString(current)) {
        addIssue(issues, {
          path,
          code: 'CREDENTIAL_VALUE_FORBIDDEN',
          message: 'credential-shaped string values are forbidden',
        });
      }
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        addIssue(issues, { path, code: 'NON_FINITE_NUMBER', message: 'number must be finite' });
      } else if (Object.is(current, -0)) {
        addIssue(issues, {
          path,
          code: 'NEGATIVE_ZERO_AMBIGUOUS',
          message: 'negative zero is forbidden because canonical JSON serializes it as zero',
        });
      }
      return;
    }
    if (typeof current !== 'object') {
      addIssue(issues, {
        path,
        code: 'UNSERIALIZABLE_TYPE',
        message: `payload contains unsupported ${typeof current}`,
      });
      return;
    }

    const object = current as object;
    if (ancestors.has(object)) {
      addIssue(issues, { path, code: 'CYCLIC_STRUCTURE', message: 'payload contains a cycle' });
      return;
    }
    ancestors.add(object);

    if (Array.isArray(object)) {
      if (object.length > MAX_REPLAY_ARRAY_LENGTH) {
        addIssue(issues, {
          path,
          code: 'ARRAY_TOO_LONG',
          message: `array exceeds ${MAX_REPLAY_ARRAY_LENGTH} elements`,
        });
      } else {
        const ownKeys = Reflect.ownKeys(object);
        if (ownKeys.length > object.length + 1) {
          addIssue(issues, {
            path,
            code: 'ARRAY_PROPERTY_COUNT_EXCEEDED',
            message: 'array contains extra own properties',
          });
        }
        for (const ownKey of ownKeys.slice(0, object.length + 1 + MAX_REPLAY_VALIDATION_ISSUES)) {
          if (ownKey === 'length') continue;
          if (typeof ownKey === 'symbol') {
            addIssue(issues, {
              path,
              code: isReplaySecretLikeKey(ownKey.description ?? '')
                ? 'SECRET_OR_PRIVATE_KEY'
                : 'SYMBOL_KEY_FORBIDDEN',
              message: 'symbol-keyed array properties are forbidden',
            });
            continue;
          }
          const index = /^(0|[1-9][0-9]*)$/.test(ownKey) ? Number(ownKey) : -1;
          if (!Number.isSafeInteger(index) || index < 0 || index >= object.length || String(index) !== ownKey) {
            addIssue(issues, {
              path: `${path}.${ownKey.slice(0, 40)}`,
              code: isReplaySecretLikeKey(ownKey)
                ? 'SECRET_OR_PRIVATE_KEY'
                : 'ARRAY_EXTRA_PROPERTY',
              message: 'non-index array properties are forbidden',
            });
          }
        }
        for (let i = 0; i < object.length; i += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(object, String(i));
          if (!descriptor) {
            addIssue(issues, {
              path: `${path}[${i}]`,
              code: 'SPARSE_ARRAY',
              message: 'sparse array holes are not replay-safe',
            });
          } else if (descriptor.get || descriptor.set) {
            addIssue(issues, {
              path: `${path}[${i}]`,
              code: 'ACCESSOR_FORBIDDEN',
              message: 'array accessors are forbidden',
            });
          } else if (!descriptor.enumerable) {
            addIssue(issues, {
              path: `${path}[${i}]`,
              code: 'NON_ENUMERABLE_PROPERTY',
              message: 'non-enumerable array elements are forbidden',
            });
          } else {
            visit(descriptor.value, `${path}[${i}]`, depth + 1);
          }
        }
      }
    } else {
      const proto = Object.getPrototypeOf(object);
      if (proto !== Object.prototype && proto !== null) {
        addIssue(issues, {
          path,
          code: 'NON_PLAIN_OBJECT',
          message: 'payload objects must use Object.prototype or null',
        });
      } else {
        const ownKeys = Reflect.ownKeys(object);
        if (ownKeys.length > MAX_REPLAY_OBJECT_KEYS) {
          addIssue(issues, {
            path,
            code: 'OBJECT_TOO_WIDE',
            message: `object exceeds ${MAX_REPLAY_OBJECT_KEYS} keys`,
          });
        } else {
          const keys: string[] = [];
          for (const ownKey of ownKeys) {
            if (typeof ownKey === 'symbol') {
              addIssue(issues, {
                path,
                code: isReplaySecretLikeKey(ownKey.description ?? '')
                  ? 'SECRET_OR_PRIVATE_KEY'
                  : 'SYMBOL_KEY_FORBIDDEN',
                message: 'symbol-keyed payload fields are forbidden',
              });
            } else {
              keys.push(ownKey);
            }
          }
          keys.sort();
          for (const key of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(object, key);
            if (!descriptor) continue;
            if (DANGEROUS_PROPERTY_KEYS.has(key)) {
              addIssue(issues, {
                path: `${path}.${key}`,
                code: 'DANGEROUS_PROPERTY_KEY',
                message: 'prototype-affecting property names are forbidden',
              });
              continue;
            }
            if (isReplaySecretLikeKey(key)) {
              addIssue(issues, {
                path: `${path}.${key.slice(0, 40)}`,
                code: 'SECRET_OR_PRIVATE_KEY',
                message: 'secret-like or private payload keys are forbidden',
              });
              continue;
            }
            if (descriptor.get || descriptor.set) {
              addIssue(issues, {
                path: `${path}.${key}`,
                code: 'ACCESSOR_FORBIDDEN',
                message: 'payload accessors are forbidden',
              });
              continue;
            }
            if (!descriptor.enumerable) {
              addIssue(issues, {
                path: `${path}.${key.slice(0, 40)}`,
                code: 'NON_ENUMERABLE_PROPERTY',
                message: 'non-enumerable payload fields are forbidden',
              });
              continue;
            }
            if (key.length > 200) {
              addIssue(issues, {
                path: `${path}.${key.slice(0, 20)}`,
                code: 'KEY_TOO_LONG',
                message: 'object key exceeds 200 characters',
              });
            }
            visit(descriptor.value, `${path}.${key}`, depth + 1);
          }
        }
      }
    }
    ancestors.delete(object);
  };

  visit(value, '$', 0);
  return issues;
}

export interface GuardReplayPayloadContext {
  kind: string;
  createdAtMs: number;
  authority: Exclude<
    'LIVE_PUBLIC' | 'LIVE_PRIVATE' | 'DERIVED_LIVE' | 'RECORDED_REPLAY' | 'SYNTHETIC_TEST' | 'UNAVAILABLE',
    'LIVE_PRIVATE'
  >;
  correlationId: string | null;
  nowMs: number;
}

/** Validates, secret-guards, size-bounds, clones, and freezes a payload. */
export function guardReplayPayload(
  payload: unknown,
  context: GuardReplayPayloadContext,
): ContractResult<ReplayJsonValue> {
  const issues = validateReplayPlainData(payload);
  if (issues.length > 0) {
    const privateIssue = issues.some((entry) =>
      entry.code === 'SECRET_OR_PRIVATE_KEY' || entry.code === 'CREDENTIAL_VALUE_FORBIDDEN'
    );
    return replayFailure({
      stage: 'guardPayload',
      code: privateIssue
        ? REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED
        : REPLAY_FAILURE_CODES.PAYLOAD_REJECTED,
      message: `replay payload rejected: ${issues.map((x) => `${x.path}:${x.code}`).join(', ')}`,
      nowMs: context.nowMs,
      correlationId: context.correlationId,
      safeCurrentState: 'EVENT_NOT_CAPTURED',
      recommendedOperatorAction: 'Emit bounded, dense, acyclic JSON-plain data only.',
    });
  }

  if (isReplaySecretLikeKey(context.kind)) {
    return replayFailure({
      stage: 'guardPayload',
      code: REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED,
      message: 'secret-like or private event kind is forbidden in replay capture',
      nowMs: context.nowMs,
      correlationId: context.correlationId,
      safeCurrentState: 'EVENT_NOT_CAPTURED',
      recommendedOperatorAction: 'Use a public event classification without credential material.',
    });
  }

  let canonical: string;
  try {
    canonical = canonicalJson(payload);
  } catch {
    return replayFailure({
      stage: 'guardPayload',
      code: REPLAY_FAILURE_CODES.PAYLOAD_REJECTED,
      message: 'replay payload could not be canonically serialized',
      nowMs: context.nowMs,
      correlationId: context.correlationId,
      safeCurrentState: 'EVENT_NOT_CAPTURED',
      recommendedOperatorAction: 'Emit JSON-plain data without unsupported values.',
    });
  }
  if (utf8ByteLength(canonical) > MAX_REPLAY_PAYLOAD_BYTES) {
    return replayFailure({
      stage: 'guardPayload',
      code: REPLAY_FAILURE_CODES.PAYLOAD_REJECTED,
      message: `replay payload exceeds ${MAX_REPLAY_PAYLOAD_BYTES} canonical UTF-8 bytes`,
      nowMs: context.nowMs,
      correlationId: context.correlationId,
      safeCurrentState: 'EVENT_NOT_CAPTURED',
      recommendedOperatorAction: 'Capture a smaller public evidence projection.',
    });
  }

  const guarded = createDiagnosticEnvelope(
    {
      kind: context.kind,
      createdAt: context.createdAtMs,
      authority: context.authority,
      correlationId: context.correlationId,
      payload,
    },
    context.nowMs,
    { extraPatterns: [PRIVATE_PAYLOAD_KEY_PATTERN] },
  );
  if (!guarded.ok) {
    return replayFailure({
      stage: 'guardPayload',
      code:
        guarded.failure.code === 'SECRET_FIELD_REJECTED'
          ? REPLAY_FAILURE_CODES.PRIVATE_PAYLOAD_REJECTED
          : REPLAY_FAILURE_CODES.PAYLOAD_REJECTED,
      message:
        guarded.failure.code === 'SECRET_FIELD_REJECTED'
          ? 'secret-like or private fields are forbidden in replay payloads'
          : 'replay payload is not deterministic plain data',
      nowMs: context.nowMs,
      correlationId: context.correlationId,
      safeCurrentState: 'EVENT_NOT_CAPTURED',
      recommendedOperatorAction: 'Emit a redacted public or synthetic evidence projection.',
    });
  }
  return { ok: true, value: guarded.value.payload as ReplayJsonValue };
}
