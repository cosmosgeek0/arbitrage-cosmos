export type IdentityPreflightKind =
  | 'NEW_IDENTITY'
  | 'NEW_REVISION'
  | 'DUPLICATE_NOOP'
  | 'IDENTITY_CONFLICT'
  | 'REVISION_STALE'
  | 'CAPACITY_BLOCKED';

export interface IdentityObservation {
  namespace: string;
  id: string;
  revision: number;
  fingerprint: string;
  immutableFingerprint: string;
  retainUntilMs: number;
}

export interface IdentityPreflight {
  kind: IdentityPreflightKind;
  logicalKey: string;
  reasonCode: string;
}

export interface IdentityRegistrySnapshot {
  capacity: number;
  retained: number;
  highWatermark: number;
  accepted: number;
  duplicates: number;
  conflicts: number;
  staleRevisions: number;
  capacityBlocks: number;
  pruned: number;
  poisoned: number;
}

export type IdentityCurrentStatus = 'CURRENT' | 'REVISION_STALE' | 'IDENTITY_CONFLICT' | 'MISSING';

interface IdentityRecord {
  highestRevision: number;
  fingerprint: string;
  immutableFingerprint: string;
  retainUntilMs: number;
  poisoned: boolean;
}

const HASH_PATTERN = /^[a-f0-9]{64}$/;

function positiveBound(value: unknown, name: string, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} must be a safe integer in [1, ${maximum}]`);
  }
  return value;
}

function boundedLabel(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !/^[A-Za-z0-9_.:\-]+$/.test(value)) {
    throw new TypeError(`${name} must be a bounded protocol label`);
  }
  return value;
}

function validateObservation(input: IdentityObservation): Readonly<IdentityObservation> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('identity observation must be a plain object');
  }
  const allowed = ['namespace', 'id', 'revision', 'fingerprint', 'immutableFingerprint', 'retainUntilMs'] as const;
  if (Object.keys(input).some((key) => !(allowed as readonly string[]).includes(key))) {
    throw new TypeError('identity observation contains unsupported fields');
  }
  const namespace = boundedLabel(input.namespace, 'identity namespace');
  const id = boundedLabel(input.id, 'identity id');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new TypeError('identity revision must be a non-negative safe integer');
  }
  if (!HASH_PATTERN.test(input.fingerprint) || !HASH_PATTERN.test(input.immutableFingerprint)) {
    throw new TypeError('identity fingerprints must be lowercase SHA-256 hex');
  }
  if (!Number.isSafeInteger(input.retainUntilMs) || input.retainUntilMs < 0) {
    throw new TypeError('identity retainUntilMs must be a non-negative safe integer');
  }
  return Object.freeze({
    namespace,
    id,
    revision: input.revision,
    fingerprint: input.fingerprint,
    immutableFingerprint: input.immutableFingerprint,
    retainUntilMs: input.retainUntilMs,
  });
}

function logicalKeyFor(namespace: string, id: string): string {
  return `${namespace.length}:${namespace}${id.length}:${id}`;
}

/**
 * Bounded in-memory idempotency/conflict memory for the L01 compatibility
 * seam. It never evicts an unexpired identity to admit new work.
 */
export class BoundedIdentityRegistry {
  readonly #capacity: number;
  readonly #records = new Map<string, IdentityRecord>();
  #highWatermark = 0;
  #accepted = 0;
  #duplicates = 0;
  #conflicts = 0;
  #staleRevisions = 0;
  #capacityBlocks = 0;
  #pruned = 0;

  constructor(capacity: number) {
    this.#capacity = positiveBound(capacity, 'identity capacity', 1_000_000);
  }

  preflight(input: IdentityObservation, nowMs: number): Readonly<IdentityPreflight> {
    input = validateObservation(input);
    this.#validateNow(nowMs);
    this.prune(nowMs);
    const logicalKey = logicalKeyFor(input.namespace, input.id);
    const existing = this.#records.get(logicalKey);
    if (existing === undefined) {
      if (this.#records.size >= this.#capacity) {
        this.#capacityBlocks += 1;
        return Object.freeze({ kind: 'CAPACITY_BLOCKED', logicalKey, reasonCode: 'IDENTITY_CAPACITY_EXHAUSTED' });
      }
      return Object.freeze({ kind: 'NEW_IDENTITY', logicalKey, reasonCode: 'IDENTITY_NEW' });
    }
    if (existing.poisoned) {
      this.#conflicts += 1;
      return Object.freeze({ kind: 'IDENTITY_CONFLICT', logicalKey, reasonCode: 'IDENTITY_POISONED' });
    }
    if (input.revision < existing.highestRevision) {
      this.#staleRevisions += 1;
      return Object.freeze({ kind: 'REVISION_STALE', logicalKey, reasonCode: 'ASSESSMENT_REVISION_STALE' });
    }
    if (input.revision === existing.highestRevision) {
      if (input.fingerprint === existing.fingerprint) {
        this.#duplicates += 1;
        return Object.freeze({ kind: 'DUPLICATE_NOOP', logicalKey, reasonCode: 'IDENTICAL_REDELIVERY' });
      }
      existing.poisoned = true;
      existing.retainUntilMs = Math.max(existing.retainUntilMs, input.retainUntilMs);
      this.#conflicts += 1;
      return Object.freeze({ kind: 'IDENTITY_CONFLICT', logicalKey, reasonCode: 'ASSESSMENT_IDENTITY_CONFLICT' });
    }
    if (input.immutableFingerprint !== existing.immutableFingerprint) {
      existing.poisoned = true;
      existing.retainUntilMs = Math.max(existing.retainUntilMs, input.retainUntilMs);
      this.#conflicts += 1;
      return Object.freeze({ kind: 'IDENTITY_CONFLICT', logicalKey, reasonCode: 'ASSESSMENT_ROUTE_IDENTITY_CONFLICT' });
    }
    return Object.freeze({ kind: 'NEW_REVISION', logicalKey, reasonCode: 'REVISION_ADVANCED' });
  }

  record(input: IdentityObservation, expected: 'NEW_IDENTITY' | 'NEW_REVISION', nowMs: number): void {
    input = validateObservation(input);
    this.#validateNow(nowMs);
    this.prune(nowMs);
    const logicalKey = logicalKeyFor(input.namespace, input.id);
    const existing = this.#records.get(logicalKey);
    if (expected === 'NEW_IDENTITY') {
      if (existing !== undefined || this.#records.size >= this.#capacity) {
        throw new TypeError('identity registry changed between preflight and record');
      }
      this.#records.set(logicalKey, {
        highestRevision: input.revision,
        fingerprint: input.fingerprint,
        immutableFingerprint: input.immutableFingerprint,
        retainUntilMs: input.retainUntilMs,
        poisoned: false,
      });
    } else {
      if (existing === undefined || existing.poisoned || input.revision <= existing.highestRevision
        || input.immutableFingerprint !== existing.immutableFingerprint) {
        throw new TypeError('identity revision changed between preflight and record');
      }
      existing.highestRevision = input.revision;
      existing.fingerprint = input.fingerprint;
      existing.retainUntilMs = Math.max(existing.retainUntilMs, input.retainUntilMs);
    }
    this.#accepted += 1;
    this.#highWatermark = Math.max(this.#highWatermark, this.#records.size);
  }

  currentStatus(input: IdentityObservation, nowMs: number): IdentityCurrentStatus {
    input = validateObservation(input);
    this.#validateNow(nowMs);
    this.prune(nowMs);
    const existing = this.#records.get(logicalKeyFor(input.namespace, input.id));
    if (existing === undefined) return 'MISSING';
    if (existing.poisoned) return 'IDENTITY_CONFLICT';
    if (input.revision < existing.highestRevision) return 'REVISION_STALE';
    if (input.revision > existing.highestRevision) return 'MISSING';
    return input.fingerprint === existing.fingerprint && input.immutableFingerprint === existing.immutableFingerprint
      ? 'CURRENT'
      : 'IDENTITY_CONFLICT';
  }

  prune(nowMs: number): number {
    this.#validateNow(nowMs);
    let removed = 0;
    for (const [key, record] of this.#records) {
      if (nowMs < record.retainUntilMs) continue;
      this.#records.delete(key);
      removed += 1;
    }
    this.#pruned += removed;
    return removed;
  }

  snapshot(): Readonly<IdentityRegistrySnapshot> {
    let poisoned = 0;
    for (const record of this.#records.values()) if (record.poisoned) poisoned += 1;
    return Object.freeze({
      capacity: this.#capacity,
      retained: this.#records.size,
      highWatermark: this.#highWatermark,
      accepted: this.#accepted,
      duplicates: this.#duplicates,
      conflicts: this.#conflicts,
      staleRevisions: this.#staleRevisions,
      capacityBlocks: this.#capacityBlocks,
      pruned: this.#pruned,
      poisoned,
    });
  }

  #validateNow(nowMs: number): void {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError('identity registry nowMs is invalid');
  }
}
