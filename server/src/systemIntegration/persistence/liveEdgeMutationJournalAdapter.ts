import { createHash } from 'node:crypto';

import {
  canonicalJson,
  isValidUtcMillis,
} from '../../foundation/contracts/index.js';
import {
  MUTATION_JOURNAL_LIMITS,
  applyMutationAppendRequest,
  confirmMutationAppend,
  reconstructPersistedMutationJournal,
  validateMutationAppendRequest,
  validateMutationJournalSnapshot,
  type MutationAppendAcknowledgement,
  type MutationAppendRequest,
  type MutationJournalSnapshot,
  type PersistedMutationJournal,
  type PreparedMutationAppend,
} from '../../liveEdge/adapters/durableMutationJournal/index.js';
import { canonicalPersistenceJson } from './codec.js';
import type {
  LedgerConfigCompareAndSetResult,
  LedgerEventInputRecord,
  LedgerEventRecord,
} from './types.js';

export const LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY =
  'system.integration.live-edge.mutation-journal.v1' as const;
export const LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND =
  'system.integration.live_edge.journal' as const;
export const LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND =
  'system.integration.live_edge.audit' as const;
export const LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_SCHEMA =
  'COSMOS_LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_V1' as const;
export const LIVE_EDGE_MUTATION_JOURNAL_AUDIT_SCHEMA =
  'COSMOS_LIVE_EDGE_MUTATION_JOURNAL_AUDIT_V1' as const;

export const LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_LIMITS = Object.freeze({
  maximumJournals: 64,
  maximumSerializedBytes: MUTATION_JOURNAL_LIMITS.maximumSerializedSnapshotBytes,
} as const);

const MUTATION_ID = /^l06mut_[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const AUDIT_FIELDS = Object.freeze([
  'schema', 'version', 'auditKind', 'owner', 'registryConfigKey', 'mutationKey',
  'mutationId', 'entryId', 'idempotencyKey', 'appendRequestDigest',
  'expectedJournalVersion', 'committedJournalVersion', 'previousHeadDigest',
  'committedHeadDigest', 'committedOutcomeRevision', 'entryContentRevision',
  'snapshotSha256', 'persistenceProven', 'sendAuthorized',
  'externalActionAuthorization',
] as const);

type AppendFailureCode =
  | 'CAPACITY_EXHAUSTED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'JOURNAL_TRANSITION_INVALID'
  | 'PERSISTENCE_CORRUPT'
  | 'PERSISTENCE_UNAVAILABLE'
  | 'PERSISTENCE_WRITE_FAILED'
  | 'REQUEST_BOUNDS_EXCEEDED'
  | 'UNSAFE_APPEND_REQUEST'
  | 'VERSION_CONFLICT';

export type LiveEdgeMutationJournalAdapterErrorCode =
  | 'INVALID_APPEND_REQUEST'
  | 'INVALID_MUTATION_ID'
  | 'PERSISTENCE_CORRUPT'
  | 'PERSISTENCE_UNAVAILABLE';

export class LiveEdgeMutationJournalAdapterError extends Error {
  readonly code: LiveEdgeMutationJournalAdapterErrorCode;

  constructor(code: LiveEdgeMutationJournalAdapterErrorCode, message: string) {
    super(message);
    this.name = 'LiveEdgeMutationJournalAdapterError';
    this.code = code;
  }
}

export interface LiveEdgeMutationJournalLedgerPort {
  getConfigValue(key: string): string | null;
  compareAndSetConfigValueAndLogEvents?(
    key: string,
    expectedValue: string | null,
    nextValue: string,
    records: readonly LedgerEventInputRecord[],
  ): LedgerConfigCompareAndSetResult;
  recentEvents(
    limit?: number,
    kind?: string,
    symbol?: string,
    q?: string,
    since?: number,
    beforeId?: number,
    until?: number,
    offset?: number,
    afterId?: number,
  ): LedgerEventRecord[];
}

export interface LiveEdgeMutationJournalClock {
  nowMs(): number;
}

export interface LiveEdgeMutationJournalInventory {
  readonly state: 'EMPTY' | 'AVAILABLE';
  readonly journalCount: number;
  readonly entryCount: number;
  readonly highestJournalVersion: number;
  readonly reconstructionProven: true;
  readonly persistenceOwner: 'SYSTEM_INTEGRATION_LEDGER';
  readonly sendAuthorized: false;
  readonly externalActionAuthorization: 'NONE';
}

const SYSTEM_UTC_CLOCK: LiveEdgeMutationJournalClock = Object.freeze({
  nowMs: (): number => Date.now(),
});

interface RegistryJournal {
  readonly mutationKey: string;
  readonly mutationId: string;
  readonly snapshot: Readonly<MutationJournalSnapshot>;
}

interface MutationJournalRegistry {
  readonly schema: typeof LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_SCHEMA;
  readonly version: 1;
  readonly journals: readonly Readonly<RegistryJournal>[];
}

interface MutationJournalAuditRecord {
  readonly schema: typeof LIVE_EDGE_MUTATION_JOURNAL_AUDIT_SCHEMA;
  readonly version: 1;
  readonly auditKind: 'MUTATION_JOURNAL_APPEND_COMMITTED';
  readonly owner: 'SYSTEM_INTEGRATION_LEDGER';
  readonly registryConfigKey: typeof LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY;
  readonly mutationKey: string;
  readonly mutationId: string;
  readonly entryId: string;
  readonly idempotencyKey: string;
  readonly appendRequestDigest: string;
  readonly expectedJournalVersion: number;
  readonly committedJournalVersion: number;
  readonly previousHeadDigest: string | null;
  readonly committedHeadDigest: string;
  readonly committedOutcomeRevision: string;
  readonly entryContentRevision: string;
  readonly snapshotSha256: string;
  readonly persistenceProven: false;
  readonly sendAuthorized: false;
  readonly externalActionAuthorization: 'NONE';
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function liveEdgeMutationJournalMutationKey(mutationId: string): string {
  if (!MUTATION_ID.test(mutationId)) {
    throw new LiveEdgeMutationJournalAdapterError(
      'INVALID_MUTATION_ID',
      'L06 mutation identity is not canonical',
    );
  }
  return sha256(mutationId);
}

function emptyRegistry(): Readonly<MutationJournalRegistry> {
  return Object.freeze({
    schema: LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_SCHEMA,
    version: 1 as const,
    journals: Object.freeze([]),
  });
}

function canonicalBounded(value: unknown, maximumBytes: number): string | null {
  const canonical = canonicalJson(value);
  if (Buffer.byteLength(canonical, 'utf8') > maximumBytes) return null;
  const safe = canonicalPersistenceJson(value);
  if (safe !== canonical) throw new TypeError('canonical persistence encoders disagree');
  return safe;
}

function parseRegistry(serialized: string | null): Readonly<MutationJournalRegistry> {
  if (serialized === null) return emptyRegistry();
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new LiveEdgeMutationJournalAdapterError(
      'PERSISTENCE_CORRUPT',
      'mutation-journal registry is not JSON',
    );
  }
  if (!plainRecord(value)
    || !exactFields(value, ['schema', 'version', 'journals'])
    || value.schema !== LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_SCHEMA
    || value.version !== 1
    || !Array.isArray(value.journals)
    || value.journals.length > LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_LIMITS.maximumJournals) {
    throw new LiveEdgeMutationJournalAdapterError(
      'PERSISTENCE_CORRUPT',
      'mutation-journal registry shape or capacity is invalid',
    );
  }
  let canonical: string;
  try {
    canonical = canonicalPersistenceJson(value);
  } catch {
    throw new LiveEdgeMutationJournalAdapterError(
      'PERSISTENCE_CORRUPT',
      'mutation-journal registry is unsafe or exceeds its durable bound',
    );
  }
  if (canonical !== serialized
    || Buffer.byteLength(serialized, 'utf8')
      > LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_LIMITS.maximumSerializedBytes) {
    throw new LiveEdgeMutationJournalAdapterError(
      'PERSISTENCE_CORRUPT',
      'mutation-journal registry is not canonically serialized',
    );
  }

  const journals: Readonly<RegistryJournal>[] = [];
  let previousKey: string | null = null;
  const mutationIds = new Set<string>();
  for (const candidate of value.journals) {
    if (!plainRecord(candidate)
      || !exactFields(candidate, ['mutationKey', 'mutationId', 'snapshot'])
      || typeof candidate.mutationKey !== 'string'
      || !SHA256.test(candidate.mutationKey)
      || typeof candidate.mutationId !== 'string'
      || !MUTATION_ID.test(candidate.mutationId)) {
      throw new LiveEdgeMutationJournalAdapterError(
        'PERSISTENCE_CORRUPT',
        'mutation-journal registry contains an invalid lookup record',
      );
    }
    const snapshot = validateMutationJournalSnapshot(candidate.snapshot);
    const expectedKey = liveEdgeMutationJournalMutationKey(candidate.mutationId);
    if (snapshot === null
      || snapshot.mutationId !== candidate.mutationId
      || candidate.mutationKey !== expectedKey
      || (previousKey !== null && candidate.mutationKey <= previousKey)
      || mutationIds.has(candidate.mutationId)) {
      throw new LiveEdgeMutationJournalAdapterError(
        'PERSISTENCE_CORRUPT',
        'mutation-journal registry identity, ordering, or snapshot proof is invalid',
      );
    }
    previousKey = candidate.mutationKey;
    mutationIds.add(candidate.mutationId);
    journals.push(Object.freeze({
      mutationKey: candidate.mutationKey,
      mutationId: candidate.mutationId,
      snapshot,
    }));
  }
  return Object.freeze({
    schema: LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_SCHEMA,
    version: 1 as const,
    journals: Object.freeze(journals),
  });
}

function findSnapshot(
  registry: Readonly<MutationJournalRegistry>,
  mutationId: string,
): Readonly<MutationJournalSnapshot> | null {
  const mutationKey = liveEdgeMutationJournalMutationKey(mutationId);
  return registry.journals.find((entry) => (
    entry.mutationKey === mutationKey && entry.mutationId === mutationId
  ))?.snapshot ?? null;
}

function replaceSnapshot(
  registry: Readonly<MutationJournalRegistry>,
  snapshot: Readonly<MutationJournalSnapshot>,
): Readonly<MutationJournalRegistry> | null {
  const mutationKey = liveEdgeMutationJournalMutationKey(snapshot.mutationId);
  const existingIndex = registry.journals.findIndex((entry) => (
    entry.mutationKey === mutationKey && entry.mutationId === snapshot.mutationId
  ));
  if (existingIndex < 0
    && registry.journals.length >= LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_LIMITS.maximumJournals) {
    return null;
  }
  const journals = registry.journals.map((entry) => entry);
  const replacement = Object.freeze({ mutationKey, mutationId: snapshot.mutationId, snapshot });
  if (existingIndex < 0) journals.push(replacement);
  else journals[existingIndex] = replacement;
  journals.sort((left, right) => left.mutationKey < right.mutationKey ? -1 : 1);
  return Object.freeze({
    schema: LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_SCHEMA,
    version: 1 as const,
    journals: Object.freeze(journals),
  });
}

function failedAcknowledgement(
  request: Readonly<MutationAppendRequest>,
  disposition: 'VERSION_CONFLICT' | 'FAILED' | 'CAPACITY_EXHAUSTED',
  failureCode: AppendFailureCode,
): Readonly<MutationAppendAcknowledgement> {
  return Object.freeze({
    schema: 'LIVE_EDGE_MUTATION_APPEND_ACK_V1' as const,
    version: 1 as const,
    owner: 'SYSTEM_INTEGRATION_LEDGER' as const,
    disposition,
    mutationId: request.mutationId,
    entryId: request.entryId,
    idempotencyKey: request.idempotencyKey,
    appendRequestDigest: request.appendRequestDigest,
    expectedJournalVersion: request.expectedJournalVersion,
    committedJournalVersion: null,
    previousHeadDigest: request.previousHeadDigest,
    committedHeadDigest: null,
    committedOutcomeRevision: null,
    appendedCount: 0 as const,
    ledgerEventId: null,
    committedAtMs: null,
    failureCode,
    externalActionAuthorization: 'NONE' as const,
  });
}

function auditRecord(
  request: Readonly<MutationAppendRequest>,
  snapshot: Readonly<MutationJournalSnapshot>,
): Readonly<MutationJournalAuditRecord> {
  const serializedSnapshot = canonicalBounded(
    snapshot,
    MUTATION_JOURNAL_LIMITS.maximumSerializedSnapshotBytes,
  );
  if (serializedSnapshot === null) throw new RangeError('mutation snapshot exceeds its byte bound');
  return Object.freeze({
    schema: LIVE_EDGE_MUTATION_JOURNAL_AUDIT_SCHEMA,
    version: 1 as const,
    auditKind: 'MUTATION_JOURNAL_APPEND_COMMITTED' as const,
    owner: 'SYSTEM_INTEGRATION_LEDGER' as const,
    registryConfigKey: LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY,
    mutationKey: liveEdgeMutationJournalMutationKey(request.mutationId),
    mutationId: request.mutationId,
    entryId: request.entryId,
    idempotencyKey: request.idempotencyKey,
    appendRequestDigest: request.appendRequestDigest,
    expectedJournalVersion: request.expectedJournalVersion,
    committedJournalVersion: request.nextJournalVersion,
    previousHeadDigest: request.previousHeadDigest,
    committedHeadDigest: request.nextHeadDigest,
    committedOutcomeRevision: request.nextOutcomeRevision,
    entryContentRevision: request.entryContentRevision,
    snapshotSha256: sha256(serializedSnapshot),
    persistenceProven: false as const,
    sendAuthorized: false as const,
    externalActionAuthorization: 'NONE' as const,
  });
}

function validAuditRecord(value: unknown): value is Readonly<MutationJournalAuditRecord> {
  if (!plainRecord(value) || !exactFields(value, AUDIT_FIELDS)) return false;
  try {
    canonicalPersistenceJson(value);
  } catch {
    return false;
  }
  return value.schema === LIVE_EDGE_MUTATION_JOURNAL_AUDIT_SCHEMA
    && value.version === 1
    && value.auditKind === 'MUTATION_JOURNAL_APPEND_COMMITTED'
    && value.owner === 'SYSTEM_INTEGRATION_LEDGER'
    && value.registryConfigKey === LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY
    && typeof value.mutationKey === 'string' && SHA256.test(value.mutationKey)
    && typeof value.mutationId === 'string' && MUTATION_ID.test(value.mutationId)
    && typeof value.snapshotSha256 === 'string' && SHA256.test(value.snapshotSha256)
    && value.persistenceProven === false
    && value.sendAuthorized === false
    && value.externalActionAuthorization === 'NONE';
}

function exactRequestSnapshotBinding(
  request: Readonly<MutationAppendRequest>,
  snapshot: Readonly<MutationJournalSnapshot>,
): boolean {
  const tail = snapshot.entries.at(-1);
  return snapshot.mutationId === request.mutationId
    && snapshot.journalVersion === request.nextJournalVersion
    && snapshot.headDigest === request.nextHeadDigest
    && snapshot.outcomeRevision === request.nextOutcomeRevision
    && tail?.entryId === request.entryId
    && tail.contentRevision === request.entryContentRevision
    && canonicalJson(tail) === canonicalJson(request.entry);
}

function capacityIsKnownExhausted(
  snapshot: Readonly<MutationJournalSnapshot>,
  request: Readonly<MutationAppendRequest>,
): boolean {
  if (snapshot.journalVersion >= MUTATION_JOURNAL_LIMITS.maximumEntries) return true;
  const kind = request.entry.kind;
  const count = snapshot.entries.filter((entry) => entry.kind === kind).length;
  if (kind === 'TELEMETRY_DEGRADED') {
    return count >= MUTATION_JOURNAL_LIMITS.maximumTelemetryEntries
      || snapshot.journalVersion >= MUTATION_JOURNAL_LIMITS.maximumEntries
        - MUTATION_JOURNAL_LIMITS.reservedMoneyCriticalEntries;
  }
  const maximumByKind: Readonly<Partial<Record<typeof kind, number>>> = Object.freeze({
    HTTP_OBSERVED: MUTATION_JOURNAL_LIMITS.maximumHttpEntries,
    PRIVATE_ORDER_OBSERVED: MUTATION_JOURNAL_LIMITS.maximumPrivateOrderEntries,
    PRIVATE_FILL_OBSERVED: MUTATION_JOURNAL_LIMITS.maximumPrivateFillEntries,
    FOUNDATION_RECONCILIATION_OBSERVED: MUTATION_JOURNAL_LIMITS.maximumReconciliationEntries,
    OBSERVATION_ID_CONFLICT: MUTATION_JOURNAL_LIMITS.maximumObservationIdentityConflictEntries,
  });
  const maximum = maximumByKind[kind];
  return maximum !== undefined && count >= maximum;
}

export class LiveEdgeMutationJournalPersistenceAdapter {
  readonly #ledger: LiveEdgeMutationJournalLedgerPort;
  readonly #clock: LiveEdgeMutationJournalClock;

  constructor(
    ledger: LiveEdgeMutationJournalLedgerPort,
    clock: LiveEdgeMutationJournalClock = SYSTEM_UTC_CLOCK,
  ) {
    if (ledger === null || typeof ledger !== 'object'
      || typeof ledger.getConfigValue !== 'function'
      || typeof ledger.recentEvents !== 'function') {
      throw new TypeError('LiveEdge mutation-journal adapter requires the canonical Ledger port');
    }
    if (clock === null || typeof clock !== 'object' || typeof clock.nowMs !== 'function') {
      throw new TypeError('LiveEdge mutation-journal adapter requires an injected UTC clock');
    }
    this.#ledger = ledger;
    this.#clock = clock;
  }

  #loadRegistry(): { readonly serialized: string | null; readonly registry: Readonly<MutationJournalRegistry> } {
    let serialized: string | null;
    try {
      serialized = this.#ledger.getConfigValue(LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY);
    } catch {
      throw new LiveEdgeMutationJournalAdapterError(
        'PERSISTENCE_UNAVAILABLE',
        'canonical Ledger config read is unavailable',
      );
    }
    return Object.freeze({ serialized, registry: parseRegistry(serialized) });
  }

  #eventsForMutation(mutationId: string): Readonly<{
    journalEvents: readonly Readonly<LedgerEventRecord>[];
    auditEvents: readonly Readonly<LedgerEventRecord>[];
  }> {
    let journalEvents: LedgerEventRecord[];
    let auditEvents: LedgerEventRecord[];
    try {
      journalEvents = this.#ledger.recentEvents(
        MUTATION_JOURNAL_LIMITS.maximumEntries + 1,
        LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND,
        mutationId,
      );
      auditEvents = this.#ledger.recentEvents(
        MUTATION_JOURNAL_LIMITS.maximumEntries + 1,
        LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND,
        mutationId,
      );
    } catch {
      throw new LiveEdgeMutationJournalAdapterError(
        'PERSISTENCE_UNAVAILABLE',
        'canonical Ledger event readback is unavailable',
      );
    }
    return Object.freeze({
      journalEvents: Object.freeze(journalEvents),
      auditEvents: Object.freeze(auditEvents),
    });
  }

  #assertNoOrphanEvents(mutationId: string): void {
    const events = this.#eventsForMutation(mutationId);
    if (events.journalEvents.length > 0 || events.auditEvents.length > 0) {
      throw new LiveEdgeMutationJournalAdapterError(
        'PERSISTENCE_CORRUPT',
        'mutation-journal Ledger events exist without their canonical registry snapshot',
      );
    }
  }

  #reconstructSnapshotLineage(
    configuredSnapshot: Readonly<MutationJournalSnapshot>,
    requestedVersion: number,
  ): Readonly<PersistedMutationJournal> {
    const mutationId = configuredSnapshot.mutationId;
    const events = this.#eventsForMutation(mutationId);
    if (events.journalEvents.length !== configuredSnapshot.journalVersion
      || events.auditEvents.length !== configuredSnapshot.journalVersion) {
      throw new LiveEdgeMutationJournalAdapterError(
        'PERSISTENCE_CORRUPT',
        'mutation-journal recovery-record count does not match the canonical registry snapshot',
      );
    }

    const journalByVersion = new Map<number, Readonly<{
      event: Readonly<LedgerEventRecord>;
      request: Readonly<MutationAppendRequest>;
    }>>();
    for (const event of events.journalEvents) {
      const request = validateMutationAppendRequest(event.data);
      if (event.kind !== LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND
        || event.symbol !== mutationId
        || !Number.isSafeInteger(event.id) || event.id < 1
        || !isValidUtcMillis(event.ts)
        || request === null
        || request.mutationId !== mutationId
        || journalByVersion.has(request.nextJournalVersion)) {
        throw new LiveEdgeMutationJournalAdapterError(
          'PERSISTENCE_CORRUPT',
          'dedicated mutation-journal Ledger lineage is invalid or duplicated',
        );
      }
      journalByVersion.set(request.nextJournalVersion, Object.freeze({ event, request }));
    }

    const auditByVersion = new Map<number, Readonly<LedgerEventRecord>>();
    for (const event of events.auditEvents) {
      if (event.kind !== LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND
        || event.symbol !== mutationId
        || !Number.isSafeInteger(event.id) || event.id < 1
        || !isValidUtcMillis(event.ts)
        || !validAuditRecord(event.data)
        || event.data.mutationId !== mutationId
        || !Number.isSafeInteger(event.data.committedJournalVersion)
        || auditByVersion.has(event.data.committedJournalVersion)) {
        throw new LiveEdgeMutationJournalAdapterError(
          'PERSISTENCE_CORRUPT',
          'canonical mutation-journal audit lineage is invalid or duplicated',
        );
      }
      auditByVersion.set(event.data.committedJournalVersion, event);
    }

    let rebuilt: Readonly<MutationJournalSnapshot> | null = null;
    let requested: Readonly<PersistedMutationJournal> | null = null;
    let previousAuditEventId = 0;
    for (let version = 1; version <= configuredSnapshot.journalVersion; version += 1) {
      const journal = journalByVersion.get(version);
      const auditEvent = auditByVersion.get(version);
      if (journal === undefined || auditEvent === undefined) {
        throw new LiveEdgeMutationJournalAdapterError(
          'PERSISTENCE_CORRUPT',
          'mutation-journal Ledger lineage has a missing interior version',
        );
      }
      const next = applyMutationAppendRequest(rebuilt, journal.request);
      if (next === null) {
        throw new LiveEdgeMutationJournalAdapterError(
          'PERSISTENCE_CORRUPT',
          'mutation-journal Ledger lineage cannot be replayed by the donor reducer',
        );
      }
      const acknowledgement = Object.freeze({
        schema: 'LIVE_EDGE_MUTATION_APPEND_ACK_V1' as const,
        version: 1 as const,
        owner: 'SYSTEM_INTEGRATION_LEDGER' as const,
        disposition: 'IDEMPOTENT_REPLAY' as const,
        mutationId: journal.request.mutationId,
        entryId: journal.request.entryId,
        idempotencyKey: journal.request.idempotencyKey,
        appendRequestDigest: journal.request.appendRequestDigest,
        expectedJournalVersion: journal.request.expectedJournalVersion,
        committedJournalVersion: journal.request.nextJournalVersion,
        previousHeadDigest: journal.request.previousHeadDigest,
        committedHeadDigest: journal.request.nextHeadDigest,
        committedOutcomeRevision: journal.request.nextOutcomeRevision,
        appendedCount: 0 as const,
        ledgerEventId: journal.event.id,
        committedAtMs: journal.event.ts,
        failureCode: null,
        externalActionAuthorization: 'NONE' as const,
      });
      const persisted = reconstructPersistedMutationJournal(next.entries, acknowledgement);
      const expectedAudit = auditRecord(journal.request, next);
      if (persisted === null
        || !exactRequestSnapshotBinding(journal.request, persisted.snapshot)
        || journal.event.id <= previousAuditEventId
        || auditEvent.id !== journal.event.id + 1
        || auditEvent.ts !== journal.event.ts
        || !validAuditRecord(auditEvent.data)
        || canonicalJson(auditEvent.data) !== canonicalJson(expectedAudit)) {
        throw new LiveEdgeMutationJournalAdapterError(
          'PERSISTENCE_CORRUPT',
          'mutation-journal and canonical audit lineage are split, reordered, or mismatched',
        );
      }
      if (version === requestedVersion) requested = persisted;
      rebuilt = next;
      previousAuditEventId = auditEvent.id;
    }
    if (rebuilt === null
      || requested === null
      || canonicalJson(rebuilt) !== canonicalJson(configuredSnapshot)) {
      throw new LiveEdgeMutationJournalAdapterError(
        'PERSISTENCE_CORRUPT',
        'replayed mutation-journal lineage does not equal the canonical registry snapshot',
      );
    }
    return requested;
  }

  #validateRegistryLineages(
    registry: Readonly<MutationJournalRegistry>,
    targetMutationId: string,
    targetVersion: number | null,
  ): Readonly<PersistedMutationJournal> | null {
    let target: Readonly<PersistedMutationJournal> | null = null;
    let targetFound = false;
    for (const journal of registry.journals) {
      const isTarget = journal.mutationId === targetMutationId;
      const persisted = this.#reconstructSnapshotLineage(
        journal.snapshot,
        isTarget && targetVersion !== null ? targetVersion : journal.snapshot.journalVersion,
      );
      if (isTarget) {
        targetFound = true;
        target = persisted;
      }
    }
    if (!targetFound) this.#assertNoOrphanEvents(targetMutationId);
    return target;
  }

  #readVersion(
    mutationId: string,
    journalVersion: number,
  ): Readonly<PersistedMutationJournal> | null {
    const loaded = this.#loadRegistry();
    const current = findSnapshot(loaded.registry, mutationId);
    if (current === null) {
      this.#validateRegistryLineages(loaded.registry, mutationId, null);
      return null;
    }
    if (!Number.isSafeInteger(journalVersion)
      || journalVersion < 1
      || journalVersion > current.journalVersion) return null;
    return this.#validateRegistryLineages(loaded.registry, mutationId, journalVersion);
  }

  read(mutationId: string): Readonly<PersistedMutationJournal> | null {
    liveEdgeMutationJournalMutationKey(mutationId);
    const loaded = this.#loadRegistry();
    const current = findSnapshot(loaded.registry, mutationId);
    return this.#validateRegistryLineages(
      loaded.registry,
      mutationId,
      current?.journalVersion ?? null,
    );
  }

  /**
   * Bounded production availability/readback for the canonical L06 registry.
   * This validates every configured lineage with the accepted donor reducer;
   * it does not expose mutation contents or infer execution/account truth.
   */
  inspectInventory(): Readonly<LiveEdgeMutationJournalInventory> {
    const loaded = this.#loadRegistry();
    if (loaded.registry.journals.length === 0) {
      let journalEvents: readonly Readonly<LedgerEventRecord>[];
      let auditEvents: readonly Readonly<LedgerEventRecord>[];
      try {
        journalEvents = this.#ledger.recentEvents(1, LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND);
        auditEvents = this.#ledger.recentEvents(1, LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND);
      } catch {
        throw new LiveEdgeMutationJournalAdapterError(
          'PERSISTENCE_UNAVAILABLE',
          'canonical Ledger inventory readback is unavailable',
        );
      }
      if (journalEvents.length > 0 || auditEvents.length > 0) {
        throw new LiveEdgeMutationJournalAdapterError(
          'PERSISTENCE_CORRUPT',
          'mutation-journal Ledger events exist without the canonical registry',
        );
      }
      return Object.freeze({
        state: 'EMPTY',
        journalCount: 0,
        entryCount: 0,
        highestJournalVersion: 0,
        reconstructionProven: true,
        persistenceOwner: 'SYSTEM_INTEGRATION_LEDGER',
        sendAuthorized: false,
        externalActionAuthorization: 'NONE',
      });
    }

    let entryCount = 0;
    let highestJournalVersion = 0;
    for (const journal of loaded.registry.journals) {
      const persisted = this.#reconstructSnapshotLineage(
        journal.snapshot,
        journal.snapshot.journalVersion,
      );
      entryCount += persisted.snapshot.entries.length;
      highestJournalVersion = Math.max(highestJournalVersion, persisted.snapshot.journalVersion);
    }
    return Object.freeze({
      state: 'AVAILABLE',
      journalCount: loaded.registry.journals.length,
      entryCount,
      highestJournalVersion,
      reconstructionProven: true,
      persistenceOwner: 'SYSTEM_INTEGRATION_LEDGER',
      sendAuthorized: false,
      externalActionAuthorization: 'NONE',
    });
  }

  #classifyWithoutWrite(
    request: Readonly<MutationAppendRequest>,
    current: Readonly<MutationJournalSnapshot> | null,
  ): Readonly<MutationAppendAcknowledgement> {
    if (current !== null && current.journalVersion >= request.nextJournalVersion) {
      let persisted: Readonly<PersistedMutationJournal> | null = null;
      try {
        persisted = this.#readVersion(request.mutationId, request.nextJournalVersion);
      } catch (error) {
        if (error instanceof LiveEdgeMutationJournalAdapterError
          && error.code === 'PERSISTENCE_UNAVAILABLE') {
          return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_UNAVAILABLE');
        }
        if (error instanceof LiveEdgeMutationJournalAdapterError
          && error.code === 'PERSISTENCE_CORRUPT') {
          return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_CORRUPT');
        }
        throw error;
      }
      if (persisted !== null) {
        if (persisted.acknowledgement.appendRequestDigest === request.appendRequestDigest
          && exactRequestSnapshotBinding(request, persisted.snapshot)) {
          const confirmed = confirmMutationAppend(
            Object.freeze({ request, nextSnapshot: persisted.snapshot }) satisfies PreparedMutationAppend,
            persisted.acknowledgement,
          );
          if (confirmed.ok) return persisted.acknowledgement;
          return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_CORRUPT');
        }
        if (persisted.acknowledgement.idempotencyKey === request.idempotencyKey) {
          return failedAcknowledgement(request, 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT');
        }
      }
    }
    if (current !== null
      && request.expectedJournalVersion === current.journalVersion
      && request.previousHeadDigest === current.headDigest) {
      if (capacityIsKnownExhausted(current, request)) {
        return failedAcknowledgement(request, 'CAPACITY_EXHAUSTED', 'CAPACITY_EXHAUSTED');
      }
      return failedAcknowledgement(request, 'FAILED', 'JOURNAL_TRANSITION_INVALID');
    }
    return failedAcknowledgement(request, 'VERSION_CONFLICT', 'VERSION_CONFLICT');
  }

  append(requestValue: unknown): Readonly<MutationAppendAcknowledgement> {
    const request = validateMutationAppendRequest(requestValue);
    if (request === null) {
      throw new LiveEdgeMutationJournalAdapterError(
        'INVALID_APPEND_REQUEST',
        'L06 append request failed the accepted donor validator',
      );
    }
    let requestBytes: string;
    try {
      requestBytes = canonicalPersistenceJson(request);
    } catch {
      return failedAcknowledgement(request, 'FAILED', 'UNSAFE_APPEND_REQUEST');
    }
    if (Buffer.byteLength(requestBytes, 'utf8')
        > MUTATION_JOURNAL_LIMITS.maximumSerializedAppendRequestBytes
      || Buffer.byteLength(canonicalJson(request.entry), 'utf8')
        > MUTATION_JOURNAL_LIMITS.maximumSerializedEntryBytes) {
      return failedAcknowledgement(request, 'FAILED', 'REQUEST_BOUNDS_EXCEEDED');
    }
    if (typeof this.#ledger.compareAndSetConfigValueAndLogEvents !== 'function') {
      return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_UNAVAILABLE');
    }

    let loaded: { readonly serialized: string | null; readonly registry: Readonly<MutationJournalRegistry> };
    try {
      loaded = this.#loadRegistry();
    } catch (error) {
      if (error instanceof LiveEdgeMutationJournalAdapterError
        && error.code === 'PERSISTENCE_CORRUPT') {
        return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_CORRUPT');
      }
      return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_UNAVAILABLE');
    }
    const prior = findSnapshot(loaded.registry, request.mutationId);
    const next = applyMutationAppendRequest(prior, request);
    if (next === null) return this.#classifyWithoutWrite(request, prior);

    const nextRegistry = replaceSnapshot(loaded.registry, next);
    if (nextRegistry === null) {
      return failedAcknowledgement(request, 'CAPACITY_EXHAUSTED', 'CAPACITY_EXHAUSTED');
    }
    let serializedNext: string | null;
    try {
      serializedNext = canonicalBounded(
        nextRegistry,
        LIVE_EDGE_MUTATION_JOURNAL_REGISTRY_LIMITS.maximumSerializedBytes,
      );
    } catch {
      return failedAcknowledgement(request, 'FAILED', 'UNSAFE_APPEND_REQUEST');
    }
    if (serializedNext === null) {
      return failedAcknowledgement(request, 'CAPACITY_EXHAUSTED', 'CAPACITY_EXHAUSTED');
    }
    try {
      this.#validateRegistryLineages(
        loaded.registry,
        request.mutationId,
        prior?.journalVersion ?? null,
      );
    } catch (error) {
      if (error instanceof LiveEdgeMutationJournalAdapterError
        && error.code === 'PERSISTENCE_CORRUPT') {
        return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_CORRUPT');
      }
      return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_UNAVAILABLE');
    }
    let nowMs: number;
    try {
      nowMs = this.#clock.nowMs();
    } catch {
      return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_UNAVAILABLE');
    }
    if (!isValidUtcMillis(nowMs)) {
      return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_UNAVAILABLE');
    }
    if (request.entry.receivedAtMs > nowMs) {
      return failedAcknowledgement(request, 'FAILED', 'UNSAFE_APPEND_REQUEST');
    }
    const audit = auditRecord(request, next);
    const records = Object.freeze([
      Object.freeze({
        kind: LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND,
        symbol: request.mutationId,
        data: request,
      }),
      Object.freeze({
        kind: LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND,
        symbol: request.mutationId,
        data: audit,
      }),
    ]);

    let result: LedgerConfigCompareAndSetResult;
    try {
      result = this.#ledger.compareAndSetConfigValueAndLogEvents(
        LIVE_EDGE_MUTATION_JOURNAL_CONFIG_KEY,
        loaded.serialized,
        serializedNext,
        records,
      );
    } catch {
      try {
        const recovered = this.#readVersion(request.mutationId, request.nextJournalVersion);
        if (recovered !== null
          && recovered.acknowledgement.appendRequestDigest === request.appendRequestDigest
          && exactRequestSnapshotBinding(request, recovered.snapshot)) {
          const acknowledgement = Object.freeze({
            ...recovered.acknowledgement,
            disposition: 'COMMITTED_NEW' as const,
            appendedCount: 1 as const,
          });
          const confirmed = confirmMutationAppend(
            Object.freeze({ request, nextSnapshot: recovered.snapshot }) satisfies PreparedMutationAppend,
            acknowledgement,
          );
          if (confirmed.ok) return acknowledgement;
        }
      } catch {
        // The failed transaction remains authoritative when no exact committed pair can be read back.
      }
      return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_WRITE_FAILED');
    }
    if (!result.committed) {
      let current: Readonly<MutationJournalSnapshot> | null = null;
      try {
        const registry = parseRegistry(result.currentValue);
        current = findSnapshot(registry, request.mutationId);
      } catch {
        return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_CORRUPT');
      }
      const targetUnchanged = prior === null
        ? current === null
        : current !== null && canonicalJson(current) === canonicalJson(prior);
      if (targetUnchanged) {
        return failedAcknowledgement(request, 'VERSION_CONFLICT', 'VERSION_CONFLICT');
      }
      return this.#classifyWithoutWrite(request, current);
    }
    if (result.events.length !== 2) {
      return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_CORRUPT');
    }
    const [journalEvent, auditEvent] = result.events;
    if (!journalEvent || !auditEvent
      || journalEvent.kind !== LIVE_EDGE_MUTATION_JOURNAL_EVENT_KIND
      || auditEvent.kind !== LIVE_EDGE_MUTATION_JOURNAL_AUDIT_EVENT_KIND
      || journalEvent.symbol !== request.mutationId
      || auditEvent.symbol !== request.mutationId
      || !Number.isSafeInteger(journalEvent.id) || journalEvent.id < 1
      || auditEvent.id !== journalEvent.id + 1
      || journalEvent.ts !== auditEvent.ts
      || canonicalJson(journalEvent.data) !== canonicalJson(request)
      || canonicalJson(auditEvent.data) !== canonicalJson(audit)) {
      return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_CORRUPT');
    }
    const acknowledgement = Object.freeze({
      schema: 'LIVE_EDGE_MUTATION_APPEND_ACK_V1' as const,
      version: 1 as const,
      owner: 'SYSTEM_INTEGRATION_LEDGER' as const,
      disposition: 'COMMITTED_NEW' as const,
      mutationId: request.mutationId,
      entryId: request.entryId,
      idempotencyKey: request.idempotencyKey,
      appendRequestDigest: request.appendRequestDigest,
      expectedJournalVersion: request.expectedJournalVersion,
      committedJournalVersion: request.nextJournalVersion,
      previousHeadDigest: request.previousHeadDigest,
      committedHeadDigest: request.nextHeadDigest,
      committedOutcomeRevision: request.nextOutcomeRevision,
      appendedCount: 1 as const,
      ledgerEventId: journalEvent.id,
      committedAtMs: journalEvent.ts,
      failureCode: null,
      externalActionAuthorization: 'NONE' as const,
    });
    const confirmed = confirmMutationAppend(
      Object.freeze({ request, nextSnapshot: next }) satisfies PreparedMutationAppend,
      acknowledgement,
    );
    if (!confirmed.ok) {
      return failedAcknowledgement(request, 'FAILED', 'PERSISTENCE_CORRUPT');
    }
    return acknowledgement;
  }
}
