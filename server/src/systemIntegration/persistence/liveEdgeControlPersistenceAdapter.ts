import {
  canonicalJson,
} from '../../foundation/contracts/index.js';
import {
  CONTROL_REASON_CODES,
  DURABLE_CONTROL_ACTION_TYPES,
  DURABLE_CONTROL_ACK_SCHEMA,
  DURABLE_CONTROL_EVENT_SCHEMA,
  buildControlEvent,
  prepareControlEventAppend,
  validateControlRejectionReceipt,
  validateControlReceipt,
  validateDurableControlAction,
  validateRiskWitness,
  type CanonicalControlPersistencePort,
  type ControlCommandLookup,
  type ControlCommandRejectionReceipt,
  type ControlCommandReceipt,
  type ControlEventAppendAcknowledgement,
  type ControlEventAppendRequest,
  type ControlReasonCode,
  type DurableControlEvent,
} from '../../liveEdge/controls/index.js';
import {
  decodeSystemCheckpoint,
  encodeSystemCheckpoint,
} from './codec.js';
import {
  SYSTEM_PERSISTENCE_CONFIG_KEY,
  SYSTEM_PERSISTENCE_EVENT_KIND,
  SYSTEM_PERSISTENCE_LIMITS,
  type LedgerConfigCompareAndSetResult,
  type LedgerEventRecord,
  type LedgerPersistencePort,
  type PersistedLiveEdgeControlEvent,
  type SystemIntegrationCheckpointState,
  type SystemJsonValue,
} from './types.js';
import { countPendingLiveEdgeControlIntents } from './liveEdgeControlCheckpoint.js';

export const LIVE_EDGE_CONTROL_EVENT_KIND = 'system.integration.live_edge.control' as const;

const STORED_JOURNAL_KIND = 'JOURNAL' as const;
const STORED_PRE_INTENT_AUDIT_KIND = 'PRE_INTENT_AUDIT' as const;
const DEDICATED_EVENT_SCHEMA = 'cosmos.system-integration.live-edge-control-record.v1' as const;
const CANONICAL_AUDIT_SCHEMA = 'cosmos.system-integration.audit' as const;
const MAX_UTC_MS = 4_102_444_800_000;
const MAX_CONTROL_REQUEST_BYTES = 120 * 1024;
const MAX_LEDGER_SCAN = SYSTEM_PERSISTENCE_LIMITS.maximumLedgerScan;
const SHA256 = /^(?:sha256:)?[a-f0-9]{64}$/;
const CHECKPOINT_CHECKSUM = /^[a-f0-9]{64}$/;
const COMMAND_ID = /^cmd_[a-f0-9]{16,64}$/;
const EVENT_ID = /^l14evt_[a-f0-9]{64}$/;
const ACTOR_BINDING = /^l14actor_[a-f0-9]{64}$/;
const HEAD_DIGEST = /^l14head_[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

interface LoadedCheckpoint {
  readonly serialized: string;
  readonly state: Readonly<SystemIntegrationCheckpointState>;
  readonly configVersion: number | null;
}

interface JournalRow {
  readonly stored: Readonly<PersistedLiveEdgeControlEvent>;
  readonly event: Readonly<DurableControlEvent>;
}

type ControlIntentEvent = Extract<DurableControlEvent, { readonly kind: 'CONTROL_INTENT_COMMITTED' }>;

export interface LiveEdgeControlPersistenceClock {
  nowMs(): number;
}

/**
 * L14 intentionally has a numeric configuration-version contract. The current
 * composed Product runtime has no canonical numeric source, so production must
 * not construct this adapter until an owner can implement this port exactly.
 */
export interface CanonicalNumericConfigurationVersionPort {
  read(state: Readonly<SystemIntegrationCheckpointState>): number | null;
}

/** The one long-lived managed checkpoint owner used by the composed runtime. */
export interface CanonicalCheckpointStateOwnerPort {
  load(nowMs: number, emptyCorrelationId?: string): Readonly<{
    readonly ok: boolean;
    readonly state?: Readonly<SystemIntegrationCheckpointState>;
  }>;
}

/** Reservation-only cache synchronization; never publishes a control action. */
export interface CanonicalControlReservationStateOwnerPort {
  synchronizeReservedRevision(state: Readonly<SystemIntegrationCheckpointState['control']>): boolean;
}

export interface LiveEdgeControlPersistenceAdapterDependencies {
  readonly ledger: LedgerPersistencePort;
  readonly clock: LiveEdgeControlPersistenceClock;
  readonly configurationVersion: CanonicalNumericConfigurationVersionPort;
  readonly checkpointOwner: CanonicalCheckpointStateOwnerPort;
  readonly controlStateOwner: CanonicalControlReservationStateOwnerPort;
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a closed plain record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a closed plain record`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} must not contain symbol fields`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} contains missing or unknown fields`);
  }
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError(`${label}.${key} must be a data field`);
    }
    copy[key] = descriptor.value;
  }
  return copy;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function utcMillis(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MS;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function validateEvent(value: unknown): Readonly<DurableControlEvent> {
  const discriminant = (() => {
    try {
      return Object.getOwnPropertyDescriptor(value as object, 'kind')?.value;
    } catch {
      return null;
    }
  })();
  const variantFields = discriminant === 'CONTROL_INTENT_COMMITTED'
    ? ['action', 'expiresAtMs', 'decisionCode', 'riskWitness']
    : discriminant === 'CONTROL_APPLIED'
      ? ['applied', 'reasonCode', 'recoveryStateChanged']
      : discriminant === 'CONTROL_AWARENESS_RECORDED'
        ? ['recoveryRevision', 'awarenessOnly', 'recoveryStateChanged', 'reasonCode']
        : discriminant === 'CONTROL_REJECTED'
          ? ['reasonCode', 'redacted', 'intentCommitted', 'recoveryStateChanged']
          : [];
  if (variantFields.length === 0) throw new TypeError('L14 control event discriminant is invalid');
  const baseFields = [
    'schema', 'version', 'kind', 'commandId', 'previewDigest', 'actionType',
    'actorBinding', 'expectedConfigVersion', 'expectedControlRevision',
    'occurredAtMs', 'eventId', 'contentDigest', 'externalActionAuthorization',
  ];
  const row = exactRecord(value, [...baseFields, ...variantFields], 'L14 control event');
  if (row.schema !== DURABLE_CONTROL_EVENT_SCHEMA
    || row.version !== 1
    || !COMMAND_ID.test(String(row.commandId))
    || !SHA256.test(String(row.previewDigest))
    || !DURABLE_CONTROL_ACTION_TYPES.includes(row.actionType as never)
    || !ACTOR_BINDING.test(String(row.actorBinding))
    || !nonNegativeSafeInteger(row.expectedConfigVersion)
    || !nonNegativeSafeInteger(row.expectedControlRevision)
    || !utcMillis(row.occurredAtMs)
    || !EVENT_ID.test(String(row.eventId))
    || !SHA256.test(String(row.contentDigest))
    || row.externalActionAuthorization !== 'NONE') {
    throw new TypeError('L14 control event base is invalid');
  }

  if (discriminant === 'CONTROL_INTENT_COMMITTED') {
    const action = validateDurableControlAction(row.action);
    if (!action.ok || action.value.type !== row.actionType
      || !utcMillis(row.expiresAtMs) || Number(row.expiresAtMs) <= Number(row.occurredAtMs)
      || typeof row.decisionCode !== 'string'
      || !CONTROL_REASON_CODES.includes(row.decisionCode as never)) {
      throw new TypeError('L14 control intent is invalid');
    }
    if (row.riskWitness !== null) {
      const witness = validateRiskWitness(row.riskWitness);
      if (!witness.ok) throw new TypeError('L14 control intent risk witness is invalid');
    }
  } else if (discriminant === 'CONTROL_APPLIED') {
    if (typeof row.applied !== 'boolean'
      || row.recoveryStateChanged !== false
      || !((row.applied === true && row.reasonCode === 'CONTROL_APPLIED')
        || (row.applied === false && row.reasonCode === 'CONTROL_NOOP'))) {
      throw new TypeError('L14 applied event is internally inconsistent');
    }
  } else if (discriminant === 'CONTROL_AWARENESS_RECORDED') {
    if (row.actionType !== 'ACKNOWLEDGE_RECOVERY'
      || typeof row.recoveryRevision !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.recoveryRevision)
      || row.awarenessOnly !== true
      || row.recoveryStateChanged !== false
      || row.reasonCode !== 'AWARENESS_RECORDED') {
      throw new TypeError('L14 awareness event is invalid');
    }
  } else if (row.redacted !== true
    || typeof row.intentCommitted !== 'boolean'
    || row.recoveryStateChanged !== false
    || typeof row.reasonCode !== 'string'
    || !CONTROL_REASON_CODES.includes(row.reasonCode as never)
    || ['CONTROL_APPLIED', 'CONTROL_NOOP', 'AWARENESS_RECORDED'].includes(row.reasonCode)) {
    throw new TypeError('L14 rejection event is invalid');
  }

  const event = row as unknown as Readonly<DurableControlEvent>;
  const { eventId: _eventId, contentDigest: _contentDigest, ...draft } = event;
  const regenerated = buildControlEvent(draft);
  if (!canonicalEqual(regenerated, event)) throw new TypeError('L14 control event digest or identity is invalid');
  return event;
}

function validateAppendRequest(value: unknown): Readonly<ControlEventAppendRequest> {
  const row = exactRecord(value, [
    'ownerTarget', 'event', 'idempotencyKey', 'appendRequestDigest',
    'expectedJournalVersion', 'previousHeadDigest', 'nextHeadDigest',
    'externalActionAuthorization',
  ], 'L14 append request');
  const event = validateEvent(row.event);
  if (row.ownerTarget !== 'SYSTEM_INTEGRATION_LEDGER'
    || typeof row.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(row.idempotencyKey)
    || !SHA256.test(String(row.appendRequestDigest))
    || !nonNegativeSafeInteger(row.expectedJournalVersion)
    || (row.previousHeadDigest !== null && !HEAD_DIGEST.test(String(row.previousHeadDigest)))
    || !HEAD_DIGEST.test(String(row.nextHeadDigest))
    || row.externalActionAuthorization !== 'NONE') {
    throw new TypeError('L14 append request is invalid');
  }
  const canonical = prepareControlEventAppend(
    event,
    row.expectedJournalVersion,
    row.previousHeadDigest as string | null,
  );
  if (!canonicalEqual(canonical, value)) throw new TypeError('L14 append request digest or head is invalid');
  const bytes = Buffer.byteLength(canonicalJson(canonical), 'utf8');
  if (bytes > MAX_CONTROL_REQUEST_BYTES) throw new RangeError('L14 append request exceeds its byte bound');
  return canonical;
}

function parseStored(value: unknown): Readonly<PersistedLiveEdgeControlEvent> {
  const row = exactRecord(value, [
    'storageKey', 'storageKind', 'commandId', 'eventId', 'idempotencyKey',
    'appendRequestDigest', 'journalVersion', 'previousHeadDigest', 'headDigest',
    'event', 'occurredAtMs', 'checkpointRevision',
  ], 'persisted L14 control event');
  if (typeof row.storageKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(row.storageKey)
    || ![STORED_JOURNAL_KIND, STORED_PRE_INTENT_AUDIT_KIND].includes(row.storageKind as never)
    || !COMMAND_ID.test(String(row.commandId))
    || !EVENT_ID.test(String(row.eventId))
    || typeof row.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(row.idempotencyKey)
    || !SHA256.test(String(row.appendRequestDigest))
    || !Number.isSafeInteger(row.journalVersion) || Number(row.journalVersion) < 1
    || (row.previousHeadDigest !== null && !HEAD_DIGEST.test(String(row.previousHeadDigest)))
    || !HEAD_DIGEST.test(String(row.headDigest))
    || !utcMillis(row.occurredAtMs)
    || !Number.isSafeInteger(row.checkpointRevision) || Number(row.checkpointRevision) < 1) {
    throw new TypeError('persisted L14 control event is invalid');
  }
  return row as unknown as Readonly<PersistedLiveEdgeControlEvent>;
}

function parseStoredEvent(stored: Readonly<PersistedLiveEdgeControlEvent>): Readonly<DurableControlEvent> {
  const event = validateEvent(stored.event);
  const prepared = prepareControlEventAppend(
    event,
    stored.journalVersion - 1,
    stored.previousHeadDigest,
  );
  if (event.commandId !== stored.commandId
    || event.eventId !== stored.eventId
    || event.occurredAtMs !== stored.occurredAtMs
    || prepared.idempotencyKey !== stored.idempotencyKey
    || prepared.appendRequestDigest !== stored.appendRequestDigest
    || prepared.nextHeadDigest !== stored.headDigest
    || stored.storageKey !== `${stored.storageKind === STORED_PRE_INTENT_AUDIT_KIND ? 'l14audit' : 'l14control'}:${stored.idempotencyKey}`) {
    throw new TypeError('persisted L14 event is not bound to its append request');
  }
  return event;
}

function storedReceiptKey(request: Readonly<ControlEventAppendRequest>): string {
  const preIntentAudit = request.event.kind === 'CONTROL_REJECTED' && request.event.intentCommitted === false;
  return `${preIntentAudit ? 'l14audit' : 'l14control'}:${request.idempotencyKey}`;
}

function storedKind(request: Readonly<ControlEventAppendRequest>): PersistedLiveEdgeControlEvent['storageKind'] {
  return request.event.kind === 'CONTROL_REJECTED' && request.event.intentCommitted === false
    ? STORED_PRE_INTENT_AUDIT_KIND
    : STORED_JOURNAL_KIND;
}

function terminalReservationCandidates(
  intent: Readonly<ControlIntentEvent>,
): readonly Readonly<DurableControlEvent>[] {
  const common = {
    schema: DURABLE_CONTROL_EVENT_SCHEMA,
    version: 1 as const,
    commandId: intent.commandId,
    previewDigest: intent.previewDigest,
    actionType: intent.actionType,
    actorBinding: intent.actorBinding,
    expectedConfigVersion: intent.expectedConfigVersion,
    expectedControlRevision: intent.expectedControlRevision,
    externalActionAuthorization: 'NONE' as const,
  };
  const rejected = CONTROL_REASON_CODES
    .filter((reasonCode) => !['CONTROL_APPLIED', 'CONTROL_NOOP', 'AWARENESS_RECORDED'].includes(reasonCode))
    .map((reasonCode) => buildControlEvent({
      ...common,
      kind: 'CONTROL_REJECTED' as const,
      occurredAtMs: MAX_UTC_MS,
      reasonCode,
      redacted: true as const,
      intentCommitted: true,
      recoveryStateChanged: false as const,
    }));
  const successfulAtMs = intent.expiresAtMs - 1;
  if (intent.action.type === 'ACKNOWLEDGE_RECOVERY') {
    return Object.freeze([
      ...rejected,
      buildControlEvent({
        ...common,
        kind: 'CONTROL_AWARENESS_RECORDED' as const,
        occurredAtMs: successfulAtMs,
        recoveryRevision: intent.action.observedRecoveryRevision,
        awarenessOnly: true as const,
        recoveryStateChanged: false as const,
        reasonCode: 'AWARENESS_RECORDED' as const,
      }),
    ]);
  }
  return Object.freeze([
    ...rejected,
    buildControlEvent({
      ...common,
      kind: 'CONTROL_APPLIED' as const,
      occurredAtMs: successfulAtMs,
      applied: true,
      reasonCode: 'CONTROL_APPLIED' as const,
      recoveryStateChanged: false as const,
    }),
    buildControlEvent({
      ...common,
      kind: 'CONTROL_APPLIED' as const,
      occurredAtMs: successfulAtMs,
      applied: false,
      reasonCode: 'CONTROL_NOOP' as const,
      recoveryStateChanged: false as const,
    }),
  ]);
}

/** Proves every terminal variant accepted by this adapter fits before reserving an intent. */
function terminalCheckpointCapacityAvailable(
  intentState: Readonly<SystemIntegrationCheckpointState>,
  intentRequest: Readonly<ControlEventAppendRequest> & { readonly event: Readonly<ControlIntentEvent> },
): boolean {
  const terminalRevision = intentState.revision + 1;
  if (!Number.isSafeInteger(terminalRevision)) return false;
  try {
    for (const event of terminalReservationCandidates(intentRequest.event)) {
      const request = prepareControlEventAppend(event, 1, intentRequest.nextHeadDigest);
      const stored: Readonly<PersistedLiveEdgeControlEvent> = Object.freeze({
        storageKey: storedReceiptKey(request),
        storageKind: STORED_JOURNAL_KIND,
        commandId: event.commandId,
        eventId: event.eventId,
        idempotencyKey: request.idempotencyKey,
        appendRequestDigest: request.appendRequestDigest,
        journalVersion: 2,
        previousHeadDigest: intentRequest.nextHeadDigest,
        headDigest: request.nextHeadDigest,
        event: event as unknown as SystemJsonValue,
        occurredAtMs: event.occurredAtMs,
        checkpointRevision: terminalRevision,
      });
      encodeSystemCheckpoint(Object.freeze({
        ...intentState,
        revision: terminalRevision,
        liveEdgeControlEvents: Object.freeze([...intentState.liveEdgeControlEvents, stored]),
      }));
    }
    return true;
  } catch {
    return false;
  }
}

function checkpointChecksum(serialized: string): string {
  const parsed = JSON.parse(serialized) as { checksum?: unknown };
  if (typeof parsed.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.checksum)) {
    throw new TypeError('encoded System Integration checkpoint checksum is invalid');
  }
  return parsed.checksum;
}

function acknowledgement(
  request: Readonly<ControlEventAppendRequest>,
  input: Readonly<{
    disposition: ControlEventAppendAcknowledgement['disposition'];
    committedJournalVersion?: number | null;
    committedHeadDigest?: string | null;
    appendedCount?: 0 | 1;
    ledgerEventId?: number | null;
    committedAtMs?: number | null;
    currentConfigVersion: number;
    currentControlRevision: number;
    failureCode?: ControlReasonCode | null;
  }>,
): Readonly<ControlEventAppendAcknowledgement> {
  return Object.freeze({
    schema: DURABLE_CONTROL_ACK_SCHEMA,
    version: 1,
    owner: 'SYSTEM_INTEGRATION_LEDGER',
    disposition: input.disposition,
    commandId: request.event.commandId,
    eventId: request.event.eventId,
    idempotencyKey: request.idempotencyKey,
    appendRequestDigest: request.appendRequestDigest,
    expectedJournalVersion: request.expectedJournalVersion,
    committedJournalVersion: input.committedJournalVersion ?? null,
    previousHeadDigest: request.previousHeadDigest,
    committedHeadDigest: input.committedHeadDigest ?? null,
    appendedCount: input.appendedCount ?? 0,
    ledgerEventId: input.ledgerEventId ?? null,
    committedAtMs: input.committedAtMs ?? null,
    currentConfigVersion: input.currentConfigVersion,
    currentControlRevision: input.currentControlRevision,
    failureCode: input.failureCode ?? null,
    externalActionAuthorization: 'NONE',
  });
}

function eventRecord(
  event: Readonly<DurableControlEvent>,
  checkpointRevision: number,
  checkpointChecksum: string,
): SystemJsonValue {
  return {
    schema: DEDICATED_EVENT_SCHEMA,
    version: 1,
    checkpointRevision,
    checkpointChecksum,
    event: event as unknown as SystemJsonValue,
  };
}

function auditRecord(
  request: Readonly<ControlEventAppendRequest>,
  checkpointRevision: number,
  checksum: string,
): SystemJsonValue {
  return {
    schema: CANONICAL_AUDIT_SCHEMA,
    version: 1,
    auditKind: 'TRANSITION',
    correlationId: `l14.${request.event.commandId}`,
    occurredAtMs: request.event.occurredAtMs,
    checkpointRevision,
    checkpointChecksum: checksum,
    trace: null,
  };
}

/**
 * Canonical L14 persistence over the existing System Integration checkpoint.
 * It creates no table, config namespace, command owner, route, or publisher.
 */
export class LiveEdgeControlPersistenceAdapter implements CanonicalControlPersistencePort {
  private readonly ledger: LedgerPersistencePort;
  private readonly clock: LiveEdgeControlPersistenceClock;
  private readonly configurationVersion: CanonicalNumericConfigurationVersionPort;
  private readonly checkpointOwner: CanonicalCheckpointStateOwnerPort;
  private readonly controlStateOwner: CanonicalControlReservationStateOwnerPort;

  constructor(dependencies: Readonly<LiveEdgeControlPersistenceAdapterDependencies>) {
    if (!dependencies?.ledger
      || typeof dependencies.ledger.getConfigValue !== 'function'
      || typeof dependencies.ledger.compareAndSetConfigValueAndLogEvents !== 'function'
      || typeof dependencies.ledger.recentEvents !== 'function') {
      throw new TypeError('L14 persistence requires the existing Ledger CAS port');
    }
    if (!dependencies.clock || typeof dependencies.clock.nowMs !== 'function') {
      throw new TypeError('L14 persistence requires an injected clock');
    }
    if (!dependencies.configurationVersion || typeof dependencies.configurationVersion.read !== 'function') {
      throw new TypeError('L14 persistence requires a canonical numeric configuration-version port');
    }
    if (!dependencies.checkpointOwner || typeof dependencies.checkpointOwner.load !== 'function') {
      throw new TypeError('L14 persistence requires the managed canonical checkpoint owner');
    }
    if (!dependencies.controlStateOwner || typeof dependencies.controlStateOwner.synchronizeReservedRevision !== 'function') {
      throw new TypeError('L14 persistence requires the canonical reservation-only control-state owner');
    }
    this.ledger = dependencies.ledger;
    this.clock = dependencies.clock;
    this.configurationVersion = dependencies.configurationVersion;
    this.checkpointOwner = dependencies.checkpointOwner;
    this.controlStateOwner = dependencies.controlStateOwner;
  }

  private loadCheckpoint(): LoadedCheckpoint {
    const serialized = this.ledger.getConfigValue(SYSTEM_PERSISTENCE_CONFIG_KEY);
    if (serialized === null) throw new Error('canonical System Integration checkpoint is not initialized');
    const decoded = decodeSystemCheckpoint(serialized);
    if (!decoded.ok) throw new Error(`canonical System Integration checkpoint is corrupt: ${decoded.message}`);
    const configVersion = this.configurationVersion.read(decoded.value);
    if (configVersion !== null && !nonNegativeSafeInteger(configVersion)) {
      throw new Error('canonical numeric configuration version is invalid');
    }
    return Object.freeze({ serialized, state: decoded.value, configVersion });
  }

  private storedRows(state: Readonly<SystemIntegrationCheckpointState>): readonly JournalRow[] {
    const rows: JournalRow[] = [];
    for (const persisted of state.liveEdgeControlEvents) {
      const stored = parseStored(persisted);
      const event = parseStoredEvent(stored);
      rows.push(Object.freeze({ stored, event }));
    }
    return Object.freeze(rows);
  }

  private commandJournal(
    state: Readonly<SystemIntegrationCheckpointState>,
    commandId: string,
  ): readonly JournalRow[] {
    const rows = this.storedRows(state)
      .filter((row) => row.stored.storageKind === STORED_JOURNAL_KIND && row.event.commandId === commandId)
      .sort((left, right) => left.stored.journalVersion - right.stored.journalVersion);
    if (rows.length === 0) return Object.freeze([]);
    if (rows.length > 2 || rows[0].stored.journalVersion !== 1
      || rows[0].event.kind !== 'CONTROL_INTENT_COMMITTED'
      || rows[0].stored.previousHeadDigest !== null) {
      throw new TypeError('persisted L14 command journal does not begin with one intent');
    }
    const intent = rows[0].event;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.stored.journalVersion !== index + 1
        || (index > 0 && row.stored.previousHeadDigest !== rows[index - 1].stored.headDigest)
        || row.event.commandId !== intent.commandId
        || row.event.previewDigest !== intent.previewDigest
        || row.event.actorBinding !== intent.actorBinding
        || row.event.actionType !== intent.actionType
        || row.event.expectedConfigVersion !== intent.expectedConfigVersion
        || row.event.expectedControlRevision !== intent.expectedControlRevision
        || row.event.occurredAtMs < intent.occurredAtMs) {
        throw new TypeError('persisted L14 command journal continuity is corrupt');
      }
    }
    if (rows.length === 2) {
      const terminal = rows[1].event;
      if (terminal.kind === 'CONTROL_INTENT_COMMITTED'
        || (terminal.kind === 'CONTROL_REJECTED' && terminal.intentCommitted !== true)
        || (terminal.kind === 'CONTROL_AWARENESS_RECORDED'
          && (intent.action.type !== 'ACKNOWLEDGE_RECOVERY'
            || terminal.recoveryRevision !== intent.action.observedRecoveryRevision))
        || (terminal.kind === 'CONTROL_APPLIED' && intent.action.type === 'ACKNOWLEDGE_RECOVERY')) {
        throw new TypeError('persisted L14 command journal terminal is invalid');
      }
    }
    return Object.freeze(rows);
  }

  private findDedicatedEvent(
    stored: Readonly<PersistedLiveEdgeControlEvent>,
    event: Readonly<DurableControlEvent>,
  ): Readonly<LedgerEventRecord> {
    const matches = this.ledger.recentEvents(
      MAX_LEDGER_SCAN,
      LIVE_EDGE_CONTROL_EVENT_KIND,
      event.commandId,
    ).filter((record) => {
      if (record.data === null || typeof record.data !== 'object' || Array.isArray(record.data)) return false;
      const data = record.data as Record<string, unknown>;
      if (data.schema !== DEDICATED_EVENT_SCHEMA || data.version !== 1
        || data.checkpointRevision !== stored.checkpointRevision
        || typeof data.checkpointChecksum !== 'string'
        || !CHECKPOINT_CHECKSUM.test(data.checkpointChecksum)
        || data.event === null || typeof data.event !== 'object') return false;
      const storedEvent = data.event as Record<string, unknown>;
      return record.ts >= event.occurredAtMs
        && storedEvent.eventId === event.eventId
        && canonicalEqual(data, eventRecord(event, stored.checkpointRevision, data.checkpointChecksum));
    });
    if (matches.length !== 1) throw new Error('canonical L14 dedicated event readback is unavailable or ambiguous');
    const dedicated = matches[0];
    const data = dedicated.data as Record<string, unknown>;
    const request = prepareControlEventAppend(event, stored.journalVersion - 1, stored.previousHeadDigest);
    const expectedAudit = auditRecord(
      request,
      stored.checkpointRevision,
      data.checkpointChecksum as string,
    );
    const audits = this.ledger.recentEvents(
      MAX_LEDGER_SCAN,
      SYSTEM_PERSISTENCE_EVENT_KIND,
      event.commandId,
    ).filter((record) => record.id === dedicated.id + 1
      && record.ts === dedicated.ts
      && canonicalEqual(record.data, expectedAudit));
    if (audits.length !== 1) throw new Error('canonical L14 audit companion is unavailable or mismatched');
    return dedicated;
  }

  private synchronizeCheckpointOwner(
    request: Readonly<ControlEventAppendRequest>,
    nowMs: number,
  ): boolean {
    try {
      const refreshed = this.checkpointOwner.load(nowMs, `l14.sync.${request.event.commandId}`);
      if (!refreshed.ok || !refreshed.state) return false;
      const stored = refreshed.state.liveEdgeControlEvents.find(
        (entry) => entry.storageKey === storedReceiptKey(request),
      );
      return stored !== undefined
        && stored.appendRequestDigest === request.appendRequestDigest
        && stored.eventId === request.event.eventId
        && ((request.event.kind === 'CONTROL_REJECTED' && request.event.intentCommitted === false)
          || refreshed.state.control.revision >= request.event.expectedControlRevision + 1)
        && this.controlStateOwner.synchronizeReservedRevision(refreshed.state.control);
    } catch {
      return false;
    }
  }

  async lookup(commandId: string): Promise<Readonly<ControlCommandLookup>> {
    if (!COMMAND_ID.test(commandId)) throw new TypeError('L14 command ID is invalid');
    const loaded = this.loadCheckpoint();
    const journal = this.commandJournal(loaded.state, commandId);
    if (journal.length === 0) {
      return Object.freeze({ kind: 'NOT_FOUND', journalVersion: 0, headDigest: null });
    }
    const intent = journal[0].event;
    if (intent.kind !== 'CONTROL_INTENT_COMMITTED') throw new TypeError('L14 journal intent is corrupt');
    const common = {
      previewDigest: intent.previewDigest,
      actorBinding: intent.actorBinding,
      journalVersion: journal.length,
      headDigest: journal.at(-1)?.stored.headDigest as string,
    };
    if (journal.length === 1) return Object.freeze({ kind: 'PENDING', ...common });
    const terminal = journal[1].event;
    const firstLedgerEvent = this.findDedicatedEvent(journal[0].stored, intent);
    const secondLedgerEvent = this.findDedicatedEvent(journal[1].stored, terminal);
    const firstLedgerEventId = firstLedgerEvent.id;
    const secondLedgerEventId = secondLedgerEvent.id;
    if ((terminal.kind === 'CONTROL_APPLIED' || terminal.kind === 'CONTROL_AWARENESS_RECORDED')
      && (terminal.occurredAtMs >= intent.expiresAtMs || secondLedgerEvent.ts >= intent.expiresAtMs)) {
      return Object.freeze({ kind: 'PENDING', ...common });
    }
    if (terminal.kind === 'CONTROL_REJECTED') {
      const rejection: Readonly<ControlCommandRejectionReceipt> = Object.freeze({
        schema: 'LIVE_EDGE_CONTROL_REJECTION_RECEIPT_V1',
        version: 1,
        commandId,
        previewDigest: intent.previewDigest,
        actionType: intent.actionType,
        actorBinding: intent.actorBinding,
        reasonCode: terminal.reasonCode,
        expectedConfigVersion: intent.expectedConfigVersion,
        committedControlRevision: intent.expectedControlRevision + 1,
        recordedAtMs: secondLedgerEvent.ts,
        ledgerEventIds: Object.freeze([firstLedgerEventId, secondLedgerEventId]) as readonly [number, number],
        recoveryStateChanged: false,
        externalActionAuthorization: 'NONE',
      });
      if (!validateControlRejectionReceipt(rejection).ok) throw new TypeError('reconstructed L14 rejection is invalid');
      return Object.freeze({ kind: 'REJECTED', ...common, rejection });
    }
    const awareness = terminal.kind === 'CONTROL_AWARENESS_RECORDED';
    if (terminal.kind !== 'CONTROL_APPLIED' && !awareness) {
      throw new TypeError('persisted L14 command terminal is invalid');
    }
    const applied = awareness ? false : terminal.applied;
    const receipt: Readonly<ControlCommandReceipt> = Object.freeze({
      schema: 'LIVE_EDGE_CONTROL_RECEIPT_V1',
      version: 1,
      commandId,
      previewDigest: intent.previewDigest,
      actionType: intent.actionType,
      disposition: awareness ? 'AWARENESS_RECORDED' : applied ? 'APPLIED' : 'NOOP',
      reasonCode: awareness ? 'AWARENESS_RECORDED' : applied ? 'CONTROL_APPLIED' : 'CONTROL_NOOP',
      actorBinding: intent.actorBinding,
      expectedConfigVersion: intent.expectedConfigVersion,
      committedControlRevision: intent.expectedControlRevision + 1,
      applied,
      recordedAtMs: secondLedgerEvent.ts,
      ledgerEventIds: Object.freeze([firstLedgerEventId, secondLedgerEventId]) as readonly [number, number],
      recoveryStateChanged: false,
      externalActionAuthorization: 'NONE',
    });
    if (!validateControlReceipt(receipt).ok) throw new TypeError('reconstructed L14 completion is invalid');
    return Object.freeze({ kind: 'COMPLETED', ...common, receipt });
  }

  async append(input: Readonly<ControlEventAppendRequest>): Promise<Readonly<ControlEventAppendAcknowledgement>> {
    const request = validateAppendRequest(input);
    const nowMs = this.clock.nowMs();
    if (!utcMillis(nowMs)) throw new TypeError('L14 persistence clock returned invalid UTC milliseconds');
    const loaded = this.loadCheckpoint();
    if (loaded.configVersion === null) {
      throw new Error('canonical numeric configuration version is NOT_CONFIGURED');
    }
    if (request.event.occurredAtMs > nowMs) {
      return acknowledgement(request, {
        disposition: 'FAILED',
        currentConfigVersion: loaded.configVersion,
        currentControlRevision: loaded.state.control.revision,
        failureCode: 'PERSISTENCE_ACK_INVALID',
      });
    }
    const persistedKey = storedReceiptKey(request);
    const existing = loaded.state.liveEdgeControlEvents.find((entry) => entry.storageKey === persistedKey);
    if (existing) {
      if (existing.appendRequestDigest !== request.appendRequestDigest) {
        return acknowledgement(request, {
          disposition: 'IDEMPOTENCY_CONFLICT',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: loaded.state.control.revision,
          failureCode: 'IDEMPOTENCY_CONFLICT',
        });
      }
      const stored = parseStored(existing);
      const event = parseStoredEvent(stored);
      if (!canonicalEqual(event, request.event)) throw new TypeError('persisted L14 idempotency record is corrupt');
      if (!this.synchronizeCheckpointOwner(request, nowMs)) {
        return acknowledgement(request, {
          disposition: 'FAILED',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: loaded.state.control.revision,
          failureCode: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      let ledgerEvent: Readonly<LedgerEventRecord>;
      try {
        ledgerEvent = this.findDedicatedEvent(stored, event);
      } catch {
        return acknowledgement(request, {
          disposition: 'FAILED',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: loaded.state.control.revision,
          failureCode: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      if (event.kind === 'CONTROL_APPLIED' || event.kind === 'CONTROL_AWARENESS_RECORDED') {
        const existingJournal = this.commandJournal(loaded.state, event.commandId);
        const intent = existingJournal[0]?.event;
        if (intent?.kind !== 'CONTROL_INTENT_COMMITTED'
          || event.occurredAtMs >= intent.expiresAtMs
          || ledgerEvent.ts >= intent.expiresAtMs) {
          return acknowledgement(request, {
            disposition: 'FAILED',
            currentConfigVersion: loaded.configVersion,
            currentControlRevision: loaded.state.control.revision,
            failureCode: 'PERSISTENCE_UNAVAILABLE',
          });
        }
      }
      if (event.kind === 'CONTROL_INTENT_COMMITTED' && ledgerEvent.ts >= event.expiresAtMs) {
        return acknowledgement(request, {
          disposition: 'FAILED',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: loaded.state.control.revision,
          failureCode: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      return acknowledgement(request, {
        disposition: 'IDEMPOTENT_REPLAY',
        committedJournalVersion: stored.journalVersion,
        committedHeadDigest: stored.headDigest,
        ledgerEventId: ledgerEvent.id,
        committedAtMs: ledgerEvent.ts,
        currentConfigVersion: loaded.configVersion,
        currentControlRevision: loaded.state.control.revision,
      });
    }

    const journal = this.commandJournal(loaded.state, request.event.commandId);
    const currentVersion = journal.length;
    const currentHead = journal.at(-1)?.stored.headDigest ?? null;
    const preIntentAudit = request.event.kind === 'CONTROL_REJECTED' && request.event.intentCommitted === false;
    if (request.event.kind === 'CONTROL_INTENT_COMMITTED'
      && (loaded.configVersion !== request.event.expectedConfigVersion
        || loaded.state.control.revision !== request.event.expectedControlRevision)) {
      return acknowledgement(request, {
        disposition: 'VERSION_CONFLICT',
        currentConfigVersion: loaded.configVersion,
        currentControlRevision: loaded.state.control.revision,
        failureCode: loaded.configVersion !== request.event.expectedConfigVersion
          ? 'STALE_CONFIG_VERSION'
          : 'STALE_CONTROL_REVISION',
      });
    }
    if (request.event.kind === 'CONTROL_INTENT_COMMITTED' && nowMs >= request.event.expiresAtMs) {
      return acknowledgement(request, {
        disposition: 'EXPIRED',
        currentConfigVersion: loaded.configVersion,
        currentControlRevision: loaded.state.control.revision,
        failureCode: 'COMMAND_EXPIRED',
      });
    }
    const pendingBefore = countPendingLiveEdgeControlIntents(loaded.state.liveEdgeControlEvents);
    if (pendingBefore === null) throw new TypeError('persisted L14 pending-intent state is corrupt');
    if (request.event.kind === 'CONTROL_INTENT_COMMITTED' && pendingBefore > 0) {
      return acknowledgement(request, {
        disposition: 'FAILED',
        currentConfigVersion: loaded.configVersion,
        currentControlRevision: loaded.state.control.revision,
        failureCode: 'COMMAND_IN_PROGRESS',
      });
    }
    if (!preIntentAudit && (
      request.expectedJournalVersion !== currentVersion
      || request.previousHeadDigest !== currentHead
      || (currentVersion === 0 && request.event.kind !== 'CONTROL_INTENT_COMMITTED')
      || (currentVersion > 0 && request.event.kind === 'CONTROL_INTENT_COMMITTED')
      || currentVersion >= 2
    )) {
      return acknowledgement(request, {
        disposition: 'VERSION_CONFLICT',
        currentConfigVersion: loaded.configVersion,
        currentControlRevision: loaded.state.control.revision,
        failureCode: 'STALE_CONTROL_REVISION',
      });
    }
    if (!preIntentAudit && currentVersion > 0) {
      const intent = journal[0].event;
      if (intent.kind !== 'CONTROL_INTENT_COMMITTED'
        || request.event.previewDigest !== intent.previewDigest
        || request.event.actorBinding !== intent.actorBinding
        || request.event.actionType !== intent.actionType
        || request.event.expectedConfigVersion !== intent.expectedConfigVersion
        || request.event.expectedControlRevision !== intent.expectedControlRevision
        || request.event.occurredAtMs < intent.occurredAtMs) {
        return acknowledgement(request, {
          disposition: 'IDEMPOTENCY_CONFLICT',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: loaded.state.control.revision,
          failureCode: 'IDEMPOTENCY_CONFLICT',
        });
      }
      if (intent.kind !== 'CONTROL_INTENT_COMMITTED') throw new TypeError('persisted L14 intent is corrupt');
      if (request.event.kind === 'CONTROL_AWARENESS_RECORDED'
        && (intent.action.type !== 'ACKNOWLEDGE_RECOVERY'
          || request.event.recoveryRevision !== intent.action.observedRecoveryRevision)) {
        return acknowledgement(request, {
          disposition: 'IDEMPOTENCY_CONFLICT',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: loaded.state.control.revision,
          failureCode: 'IDEMPOTENCY_CONFLICT',
        });
      }
      if (request.event.kind === 'CONTROL_APPLIED' && intent.action.type === 'ACKNOWLEDGE_RECOVERY') {
        return acknowledgement(request, {
          disposition: 'IDEMPOTENCY_CONFLICT',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: loaded.state.control.revision,
          failureCode: 'IDEMPOTENCY_CONFLICT',
        });
      }
      if ((request.event.kind === 'CONTROL_APPLIED' || request.event.kind === 'CONTROL_AWARENESS_RECORDED')
        && (nowMs >= intent.expiresAtMs || request.event.occurredAtMs >= intent.expiresAtMs)) {
        return acknowledgement(request, {
          disposition: 'EXPIRED',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: loaded.state.control.revision,
          failureCode: 'COMMAND_EXPIRED',
        });
      }
    }
    const terminalAppend = !preIntentAudit
      && currentVersion === 1
      && request.event.kind !== 'CONTROL_INTENT_COMMITTED';
    const pendingAfter = pendingBefore
      + (request.event.kind === 'CONTROL_INTENT_COMMITTED' ? 1 : 0)
      - (terminalAppend ? 1 : 0);
    const projectedCount = loaded.state.liveEdgeControlEvents.length + 1;
    if (projectedCount > SYSTEM_PERSISTENCE_LIMITS.maximumLiveEdgeControlEvents
      || SYSTEM_PERSISTENCE_LIMITS.maximumLiveEdgeControlEvents - projectedCount < pendingAfter) {
      return acknowledgement(request, {
        disposition: 'FAILED',
        currentConfigVersion: loaded.configVersion,
        currentControlRevision: loaded.state.control.revision,
        failureCode: 'PERSISTENCE_UNAVAILABLE',
      });
    }

    const checkpointRevision = loaded.state.revision + 1;
    const stored: Readonly<PersistedLiveEdgeControlEvent> = Object.freeze({
      storageKey: persistedKey,
      storageKind: storedKind(request),
      commandId: request.event.commandId,
      eventId: request.event.eventId,
      idempotencyKey: request.idempotencyKey,
      appendRequestDigest: request.appendRequestDigest,
      journalVersion: request.expectedJournalVersion + 1,
      previousHeadDigest: request.previousHeadDigest,
      headDigest: request.nextHeadDigest,
      event: request.event as unknown as SystemJsonValue,
      occurredAtMs: request.event.occurredAtMs,
      checkpointRevision,
    });
    const control = request.event.kind === 'CONTROL_INTENT_COMMITTED'
      ? Object.freeze({
          ...loaded.state.control,
          revision: loaded.state.control.revision + 1,
          updatedAtMs: request.event.occurredAtMs,
          correlationId: `l14.${request.event.commandId}`,
        })
      : loaded.state.control;
    const nextState: Readonly<SystemIntegrationCheckpointState> = Object.freeze({
      ...loaded.state,
      revision: checkpointRevision,
      control,
      liveEdgeControlEvents: Object.freeze([...loaded.state.liveEdgeControlEvents, stored]),
    });
    if (request.event.kind === 'CONTROL_INTENT_COMMITTED'
      && !terminalCheckpointCapacityAvailable(
        nextState,
        request as Readonly<ControlEventAppendRequest> & { readonly event: Readonly<ControlIntentEvent> },
      )) {
      return acknowledgement(request, {
        disposition: 'FAILED',
        currentConfigVersion: loaded.configVersion,
        currentControlRevision: loaded.state.control.revision,
        failureCode: 'PERSISTENCE_UNAVAILABLE',
      });
    }
    let nextSerialized: string;
    try {
      nextSerialized = encodeSystemCheckpoint(nextState);
    } catch {
      return acknowledgement(request, {
        disposition: 'FAILED',
        currentConfigVersion: loaded.configVersion,
        currentControlRevision: loaded.state.control.revision,
        failureCode: 'PERSISTENCE_UNAVAILABLE',
      });
    }
    const checksum = checkpointChecksum(nextSerialized);
    let result: LedgerConfigCompareAndSetResult;
    try {
      result = this.ledger.compareAndSetConfigValueAndLogEvents!(
        SYSTEM_PERSISTENCE_CONFIG_KEY,
        loaded.serialized,
        nextSerialized,
        Object.freeze([
          Object.freeze({
            kind: LIVE_EDGE_CONTROL_EVENT_KIND,
            symbol: request.event.commandId,
            data: eventRecord(request.event, checkpointRevision, checksum),
          }),
          Object.freeze({
            kind: SYSTEM_PERSISTENCE_EVENT_KIND,
            symbol: request.event.commandId,
            data: auditRecord(request, checkpointRevision, checksum),
          }),
        ]),
        request.event.kind === 'CONTROL_INTENT_COMMITTED'
          ? request.event.expiresAtMs
          : (request.event.kind === 'CONTROL_APPLIED' || request.event.kind === 'CONTROL_AWARENESS_RECORDED')
            && journal[0]?.event.kind === 'CONTROL_INTENT_COMMITTED'
            ? journal[0].event.expiresAtMs
            : undefined,
      );
    } catch {
      return acknowledgement(request, {
        disposition: 'FAILED',
        currentConfigVersion: loaded.configVersion,
        currentControlRevision: loaded.state.control.revision,
        failureCode: 'PERSISTENCE_UNAVAILABLE',
      });
    }
    if (result.committed) {
      if (result.events.length !== 2
        || result.events[0].kind !== LIVE_EDGE_CONTROL_EVENT_KIND
        || result.events[1].kind !== SYSTEM_PERSISTENCE_EVENT_KIND) {
        return acknowledgement(request, {
          disposition: 'FAILED',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: loaded.state.control.revision,
          failureCode: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      if (!this.synchronizeCheckpointOwner(request, result.events[0].ts)) {
        return acknowledgement(request, {
          disposition: 'FAILED',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: control.revision,
          failureCode: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      let verifiedLedgerEvent: Readonly<LedgerEventRecord>;
      try {
        verifiedLedgerEvent = this.findDedicatedEvent(stored, request.event);
      } catch {
        return acknowledgement(request, {
          disposition: 'FAILED',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: control.revision,
          failureCode: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      if (verifiedLedgerEvent.id !== result.events[0].id || verifiedLedgerEvent.ts !== result.events[0].ts) {
        return acknowledgement(request, {
          disposition: 'FAILED',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: control.revision,
          failureCode: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      if ((request.event.kind === 'CONTROL_APPLIED' || request.event.kind === 'CONTROL_AWARENESS_RECORDED')
        && journal[0]?.event.kind === 'CONTROL_INTENT_COMMITTED'
        && result.events[0].ts >= journal[0].event.expiresAtMs) {
        return acknowledgement(request, {
          disposition: 'FAILED',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: control.revision,
          failureCode: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      if (request.event.kind === 'CONTROL_INTENT_COMMITTED'
        && result.events[0].ts >= request.event.expiresAtMs) {
        return acknowledgement(request, {
          disposition: 'FAILED',
          currentConfigVersion: loaded.configVersion,
          currentControlRevision: control.revision,
          failureCode: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      return acknowledgement(request, {
        disposition: 'COMMITTED_NEW',
        committedJournalVersion: request.expectedJournalVersion + 1,
        committedHeadDigest: request.nextHeadDigest,
        appendedCount: 1,
        ledgerEventId: verifiedLedgerEvent.id,
        committedAtMs: verifiedLedgerEvent.ts,
        currentConfigVersion: loaded.configVersion,
        currentControlRevision: control.revision,
      });
    }

    if (result.reason === 'DEADLINE_EXCEEDED') {
      if (result.currentValue !== loaded.serialized) {
        throw new Error('canonical checkpoint deadline refusal returned mismatched durable truth');
      }
      return acknowledgement(request, {
        disposition: 'EXPIRED',
        currentConfigVersion: loaded.configVersion,
        currentControlRevision: loaded.state.control.revision,
        failureCode: 'COMMAND_EXPIRED',
      });
    }

    const decodedCurrent = result.currentValue === null ? null : decodeSystemCheckpoint(result.currentValue);
    if (!decodedCurrent || !decodedCurrent.ok) {
      throw new Error('canonical checkpoint changed to an invalid value during L14 CAS');
    }
    const currentConfigVersion = this.configurationVersion.read(decodedCurrent.value);
    if (!nonNegativeSafeInteger(currentConfigVersion)) {
      throw new Error('canonical numeric configuration version became NOT_CONFIGURED');
    }
    const refreshed = this.checkpointOwner.load(nowMs, `l14.conflict.${request.event.commandId}`);
    if (!refreshed.ok || !refreshed.state
      || !this.controlStateOwner.synchronizeReservedRevision(refreshed.state.control)) {
      return acknowledgement(request, {
        disposition: 'FAILED',
        currentConfigVersion,
        currentControlRevision: decodedCurrent.value.control.revision,
        failureCode: 'PERSISTENCE_UNAVAILABLE',
      });
    }
    const racedExisting = decodedCurrent.value.liveEdgeControlEvents.find(
      (entry) => entry.storageKey === persistedKey,
    );
    if (racedExisting) {
      if (racedExisting.appendRequestDigest !== request.appendRequestDigest) {
        return acknowledgement(request, {
          disposition: 'IDEMPOTENCY_CONFLICT',
          currentConfigVersion,
          currentControlRevision: decodedCurrent.value.control.revision,
          failureCode: 'IDEMPOTENCY_CONFLICT',
        });
      }
      const racedStored = parseStored(racedExisting);
      const racedEvent = parseStoredEvent(racedStored);
      let ledgerEvent: Readonly<LedgerEventRecord>;
      try {
        ledgerEvent = this.findDedicatedEvent(racedStored, racedEvent);
      } catch {
        return acknowledgement(request, {
          disposition: 'FAILED',
          currentConfigVersion,
          currentControlRevision: decodedCurrent.value.control.revision,
          failureCode: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      if (!this.synchronizeCheckpointOwner(request, ledgerEvent.ts)) {
        return acknowledgement(request, {
          disposition: 'FAILED',
          currentConfigVersion,
          currentControlRevision: decodedCurrent.value.control.revision,
          failureCode: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      if (racedEvent.kind === 'CONTROL_INTENT_COMMITTED' && ledgerEvent.ts >= racedEvent.expiresAtMs) {
        return acknowledgement(request, {
          disposition: 'FAILED',
          currentConfigVersion,
          currentControlRevision: decodedCurrent.value.control.revision,
          failureCode: 'PERSISTENCE_UNAVAILABLE',
        });
      }
      if (racedEvent.kind === 'CONTROL_APPLIED' || racedEvent.kind === 'CONTROL_AWARENESS_RECORDED') {
        const racedJournal = this.commandJournal(decodedCurrent.value, racedEvent.commandId);
        const racedIntent = racedJournal[0]?.event;
        if (racedIntent?.kind !== 'CONTROL_INTENT_COMMITTED'
          || racedEvent.occurredAtMs >= racedIntent.expiresAtMs
          || ledgerEvent.ts >= racedIntent.expiresAtMs) {
          return acknowledgement(request, {
            disposition: 'FAILED',
            currentConfigVersion,
            currentControlRevision: decodedCurrent.value.control.revision,
            failureCode: 'PERSISTENCE_UNAVAILABLE',
          });
        }
      }
      return acknowledgement(request, {
        disposition: 'IDEMPOTENT_REPLAY',
        committedJournalVersion: racedStored.journalVersion,
        committedHeadDigest: racedStored.headDigest,
        ledgerEventId: ledgerEvent.id,
        committedAtMs: ledgerEvent.ts,
        currentConfigVersion,
        currentControlRevision: decodedCurrent.value.control.revision,
      });
    }
    return acknowledgement(request, {
      disposition: 'VERSION_CONFLICT',
      currentConfigVersion,
      currentControlRevision: decodedCurrent.value.control.revision,
      failureCode: currentConfigVersion !== request.event.expectedConfigVersion
        ? 'STALE_CONFIG_VERSION'
        : 'STALE_CONTROL_REVISION',
    });
  }
}
