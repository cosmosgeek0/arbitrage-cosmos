import { createHash } from 'node:crypto';

import { canonicalJson } from '../../foundation/contracts/identity.js';
import { isValidUtcMillis } from '../../foundation/contracts/time.js';

export const AI_OPS_PORT_BASE_SHA = '492e3f69b054c85686bcfc4c09dbff4ababeda3f' as const;
export const AI_OPS_SHADOW_ORIGIN_BASE_SHA = '03857dcdaff8d8b12627d27ddcc97505da1f2f86' as const;
export const AI_OPS_SHADOW_A1_IMPLEMENTATION_SHA = '21ac214798bea6402c50ece3e026c00df4d582d8' as const;
export const AI_OPS_SHADOW_A1_SEALED_SHA = '83c1624d4a582eace27321182de35c372babbc1a' as const;
export const AI_OPS_SHADOW_A1X_IMPLEMENTATION_SHA = '8c8bcf27c915c12946a7913a9c55351124b8180f' as const;
export const AI_OPS_SHADOW_TIP_SHA = 'e65cdca872e4cd6e35a8e18c12b71f16597c80d3' as const;
/** Historical compatibility alias; active port evidence must use AI_OPS_PORT_BASE_SHA. */
export const AI_OPS_SHADOW_BASE_SHA = AI_OPS_SHADOW_ORIGIN_BASE_SHA;
export const AI_OPS_PORT_WORKTREE_REVISION = `PORT_WORKTREE_FROM_${AI_OPS_PORT_BASE_SHA}` as const;
export const AI_OPS_S6_ACCEPTED_SHA = '97e87bd7045d2883ef8c4bd3cdb7f5daf83e0437' as const;
export const AI_OPS_S6_OWNER_SHA = 'c57610cb5f7d56efb61e53ae27057fbe92a6a2f6' as const;
export const AI_OPS_SHADOW_STATE = 'SHADOW_SPECULATIVE' as const;
export const AI_OPS_HASH_PROFILE = 'AI_OPS_CANONICAL_JSON_SHA256_V1' as const;
export const AI_OPS_DONOR_ARTIFACT_CREATED_AT_MS = 1_784_001_600_000 as const;
export const AI_OPS_ARTIFACT_CREATED_AT_MS = 1_784_160_000_000 as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const SECRET_SHAPE_PATTERN = /(?:A(?:K|S)IA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|(?:sk|rk)-[A-Za-z0-9_-]{12,}|pk-(?:live|prod|test|proj)-[A-Za-z0-9_-]{8,}|gh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{8,})/i;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CANONICAL_SNAPSHOT_MAXIMUM_DEPTH = 64;
const CANONICAL_SNAPSHOT_MAXIMUM_NODES = 100_000;
const CANONICAL_SNAPSHOT_MAXIMUM_CONTAINER_ENTRIES = 10_000;
const CANONICAL_SNAPSHOT_MAXIMUM_STRING_CODE_UNITS = 1_048_576;
const CANONICAL_SNAPSHOT_MAXIMUM_TOTAL_STRING_CODE_UNITS = 16_777_216;

export interface AiOpsArtifactProvenance {
  readonly sourceRevision: typeof AI_OPS_PORT_BASE_SHA;
  readonly donorLineage: Readonly<{
    readonly originBaseRevision: typeof AI_OPS_SHADOW_ORIGIN_BASE_SHA;
    readonly a1ImplementationRevision: typeof AI_OPS_SHADOW_A1_IMPLEMENTATION_SHA;
    readonly a1SealedRevision: typeof AI_OPS_SHADOW_A1_SEALED_SHA;
    readonly a1xImplementationRevision: typeof AI_OPS_SHADOW_A1X_IMPLEMENTATION_SHA;
    readonly sealedTipRevision: typeof AI_OPS_SHADOW_TIP_SHA;
  }>;
  readonly acceptedS6Revision: typeof AI_OPS_S6_ACCEPTED_SHA;
  readonly s6OwnerLawRevision: typeof AI_OPS_S6_OWNER_SHA;
  readonly generatorId: 'ai-ops-a1-contract-generator';
  readonly generatorVersion: 2;
  readonly hashProfile: typeof AI_OPS_HASH_PROFILE;
  readonly shadowStatus: typeof AI_OPS_SHADOW_STATE;
}

export interface AiOpsArtifactEnvelope<TSchema extends string, TPayload> {
  readonly schema: TSchema;
  readonly version: 1;
  readonly revision: 1;
  readonly artifactId: string;
  readonly createdAtMs: number;
  readonly environment: 'SHADOW';
  readonly owner: 'AI_OPS_A1_CONTRACTS';
  readonly state: typeof AI_OPS_SHADOW_STATE;
  readonly provenance: Readonly<AiOpsArtifactProvenance>;
  readonly contentHash: string;
  readonly payload: Readonly<TPayload>;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  try {
    if (!isPlainRecord(value)) return false;
    const actual = Object.keys(value).sort(compareCodeUnits);
    const expected = [...keys].sort(compareCodeUnits);
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
  } catch {
    return false;
  }
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortedUnique(values: readonly string[]): readonly string[] {
  let strings: readonly string[];
  try {
    const snapshot = canonicalPolicySnapshot(values);
    if (!isDenseArray(snapshot) || Array.from(snapshot).some((value) => typeof value !== 'string')) throw new TypeError('invalid strings');
    strings = snapshot as readonly string[];
  } catch {
    throw new TypeError('sortedUnique requires strings');
  }
  return Object.freeze([...new Set(strings)].sort(compareCodeUnits));
}

export function isDenseArray(value: unknown): value is unknown[] {
  try {
    if (!Array.isArray(value) || Object.keys(value).length !== value.length) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

export function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value) && !hasSecretShape(value);
}

export function hasSecretShape(value: unknown): value is string {
  return typeof value === 'string' && SECRET_SHAPE_PATTERN.test(value);
}

export function isSafeIntegerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && !Object.is(value, -0)
    && value >= minimum;
}

export function isCanonicalBase64Url(value: unknown, minimumLength: number, maximumLength: number): value is string {
  if (
    typeof value !== 'string'
    || value.length < minimumLength
    || value.length > maximumLength
    || !/^[A-Za-z0-9_-]+$/.test(value)
    || value.length % 4 === 1
  ) return false;
  const finalValue = BASE64URL_ALPHABET.indexOf(value[value.length - 1]);
  if (finalValue < 0) return false;
  if (value.length % 4 === 2 && (finalValue & 0b1111) !== 0) return false;
  if (value.length % 4 === 3 && (finalValue & 0b11) !== 0) return false;
  return true;
}

export function isCanonicalSafeText(value: unknown, maximumLength = 512): value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximumLength
    || /[\u0000-\u001f\u007f]/.test(value)
    || hasSecretShape(value)
  ) return false;
  try {
    canonicalPolicyJson(value);
    return true;
  } catch {
    return false;
  }
}

export function assertUtcMillis(value: unknown, field: string): asserts value is number {
  if (!isValidUtcMillis(value)) throw new TypeError(`${field} must be a safe UTC millisecond value`);
}

interface CanonicalSnapshotBudget {
  nodes: number;
  stringCodeUnits: number;
}

function snapshotCanonicalValue(
  value: unknown,
  path: string,
  seen: Set<object>,
  depth: number,
  budget: CanonicalSnapshotBudget,
): unknown {
  budget.nodes += 1;
  if (depth > CANONICAL_SNAPSHOT_MAXIMUM_DEPTH || budget.nodes > CANONICAL_SNAPSHOT_MAXIMUM_NODES) {
    throw new TypeError(`canonical policy data exceeds structural limits at ${path}`);
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError(`canonical policy data contains an invalid number at ${path}`);
    }
    return value;
  }
  if (typeof value === 'string') {
    budget.stringCodeUnits += value.length;
    if (
      value.length > CANONICAL_SNAPSHOT_MAXIMUM_STRING_CODE_UNITS
      || budget.stringCodeUnits > CANONICAL_SNAPSHOT_MAXIMUM_TOTAL_STRING_CODE_UNITS
    ) throw new TypeError(`canonical policy text exceeds limits at ${path}`);
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          throw new TypeError(`canonical policy data contains a lone high surrogate at ${path}`);
        }
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new TypeError(`canonical policy data contains a lone low surrogate at ${path}`);
      }
    }
    return value;
  }
  if (typeof value !== 'object' || value === undefined) {
    throw new TypeError(`canonical policy data contains unsupported ${typeof value} at ${path}`);
  }
  const objectValue = value as object;
  if (seen.has(objectValue)) throw new TypeError(`canonical policy data contains a cycle at ${path}`);
  seen.add(objectValue);
  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
      const ownKeys = Reflect.ownKeys(descriptors);
      const lengthDescriptor = descriptors.length;
      const snapshotLength = lengthDescriptor?.value;
      if (
        lengthDescriptor === undefined
        || lengthDescriptor.enumerable !== false
        || !Object.hasOwn(lengthDescriptor, 'value')
        || !Number.isSafeInteger(snapshotLength)
        || snapshotLength < 0
        || snapshotLength > CANONICAL_SNAPSHOT_MAXIMUM_CONTAINER_ENTRIES
      ) {
        throw new TypeError(`canonical policy data contains a sparse or oversized array at ${path}`);
      }
      if (ownKeys.length !== snapshotLength + 1 || ownKeys.some((key) => typeof key !== 'string')) {
        throw new TypeError(`canonical policy data contains unsupported array properties at ${path}`);
      }
      const snapshot: unknown[] = [];
      for (let index = 0; index < snapshotLength; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError(`canonical policy data contains an accessor at ${path}[${index}]`);
        }
        snapshot.push(snapshotCanonicalValue(descriptor.value, `${path}[${index}]`, seen, depth + 1, budget));
      }
      return snapshot;
    }
    if (isPlainRecord(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
      const ownKeys = Reflect.ownKeys(descriptors);
      if (
        ownKeys.length > CANONICAL_SNAPSHOT_MAXIMUM_CONTAINER_ENTRIES
        || ownKeys.some((key) => typeof key !== 'string')
      ) throw new TypeError(`canonical policy data contains unsupported or excessive object properties at ${path}`);
      const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of ownKeys as string[]) {
        snapshotCanonicalValue(key, `${path}.<key>`, seen, depth + 1, budget);
        const descriptor = descriptors[key];
        if (descriptor === undefined || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError(`canonical policy data contains an accessor at ${path}.*`);
        }
        snapshot[key] = snapshotCanonicalValue(descriptor.value, `${path}.*`, seen, depth + 1, budget);
      }
      return snapshot;
    }
    throw new TypeError(`canonical policy data contains a non-plain object at ${path}`);
  } finally {
    seen.delete(objectValue);
  }
}

/**
 * Stricter adapter over the canonical Foundation JSON owner. It adds the
 * policy-signature profile's negative-zero and lone-surrogate rejection.
 */
export function canonicalPolicyJson(value: unknown): string {
  return canonicalJson(canonicalPolicySnapshot(value));
}

export function canonicalPolicySnapshot<T>(value: T): Readonly<T> {
  return deepFreeze(snapshotCanonicalValue(value, '$', new Set<object>(), 0, { nodes: 0, stringCodeUnits: 0 }) as T);
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalPolicyJson(value), 'utf8').digest('hex');
}

export function sha256Text(value: string): string {
  if (typeof value !== 'string') throw new TypeError('sha256Text requires text');
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function sha256Bytes(value: Uint8Array): string {
  if (!(value instanceof Uint8Array)) throw new TypeError('sha256Bytes requires bytes');
  return createHash('sha256').update(value).digest('hex');
}

export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet<object>()): Readonly<T> {
  if (value === null || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const key of Reflect.ownKeys(value as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) throw new TypeError('deepFreeze rejects accessors');
    deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

export function immutableClone<T>(value: T): Readonly<T> {
  return deepFreeze(JSON.parse(canonicalPolicyJson(value)) as T);
}

function containsSecretShape(value: unknown): boolean {
  if (typeof value === 'string') return hasSecretShape(value);
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsSecretShape);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => hasSecretShape(key) || containsSecretShape(child));
}

export function sealArtifact<TSchema extends string, TPayload>(
  schema: TSchema,
  artifactId: string,
  payload: TPayload,
): Readonly<AiOpsArtifactEnvelope<TSchema, TPayload>> {
  if (!isBoundedId(schema)) throw new TypeError('schema is invalid');
  if (!isBoundedId(artifactId)) throw new TypeError('artifactId is invalid');
  let safePayload: Readonly<TPayload>;
  try {
    safePayload = canonicalPolicySnapshot(payload);
  } catch {
    throw new TypeError('artifact payload is not closed canonical data');
  }
  if (containsSecretShape(safePayload)) throw new TypeError('artifact payload contains secret-shaped material');
  const provenance: AiOpsArtifactProvenance = {
    sourceRevision: AI_OPS_PORT_BASE_SHA,
    donorLineage: {
      originBaseRevision: AI_OPS_SHADOW_ORIGIN_BASE_SHA,
      a1ImplementationRevision: AI_OPS_SHADOW_A1_IMPLEMENTATION_SHA,
      a1SealedRevision: AI_OPS_SHADOW_A1_SEALED_SHA,
      a1xImplementationRevision: AI_OPS_SHADOW_A1X_IMPLEMENTATION_SHA,
      sealedTipRevision: AI_OPS_SHADOW_TIP_SHA,
    },
    acceptedS6Revision: AI_OPS_S6_ACCEPTED_SHA,
    s6OwnerLawRevision: AI_OPS_S6_OWNER_SHA,
    generatorId: 'ai-ops-a1-contract-generator',
    generatorVersion: 2,
    hashProfile: AI_OPS_HASH_PROFILE,
    shadowStatus: AI_OPS_SHADOW_STATE,
  };
  const body = {
    schema,
    version: 1 as const,
    revision: 1 as const,
    artifactId,
    createdAtMs: AI_OPS_ARTIFACT_CREATED_AT_MS,
    environment: 'SHADOW' as const,
    owner: 'AI_OPS_A1_CONTRACTS' as const,
    state: AI_OPS_SHADOW_STATE,
    provenance,
    payload: safePayload,
  };
  const contentHash = sha256Canonical(body);
  return immutableClone({
    ...body,
    contentHash,
  });
}
