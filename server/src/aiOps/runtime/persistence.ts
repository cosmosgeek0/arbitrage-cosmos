import type {
  LedgerConfigCompareAndSetResult,
  LedgerEventInputRecord,
} from '../../systemIntegration/persistence/types.js';
import type {
  ShadowCaseSnapshot,
  ShadowDurableEnvelope,
  ShadowDurableRecord,
} from './types.js';
import type { ShadowCaseProofVerifierPort } from './caseState.js';
import { SHADOW_A2_STATUS } from './types.js';
import {
  assertClosedKeys,
  assertDigest,
  assertIdentifier,
  assertPositive,
  assertSafeNonNegative,
  assertUtc,
  canonicalJson,
  digestValue,
  shadowSpeculativeId,
  snapshotInertJson,
} from './support.js';
import {
  assertCaseSnapshotProofsForPersistence,
  assertCaseSnapshotSuccessorForPersistence,
  assertInitialCaseSnapshotForPersistence,
  recordAttempt,
  resumeCaseSnapshot,
  serializeCaseSnapshot,
  SHADOW_CASE_ATTEMPT_LEDGER_LIMIT,
} from './caseState.js';

export interface ShadowRecordCapacity {
  readonly maximumRecords: number;
  readonly criticalReserveRecords: number;
}

const MAX_DURABLE_ENVELOPE_BYTES = 512 * 1024;
const RESERVED_COMPLETION_BYTES_PER_RECORD = 4 * 1024;
const SHADOW_DURABLE_ATTEMPT_LIMIT = 8;
export const DEFAULT_SHADOW_RECORD_CAPACITY: Readonly<ShadowRecordCapacity> = Object.freeze({
  maximumRecords: 4_096,
  criticalReserveRecords: 256,
});

function isDeepFrozenInertJson(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (seen.has(value)) return false;
  seen.add(value);
  if (!Object.isFrozen(value) || Object.getOwnPropertySymbols(value).length > 0) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!('value' in descriptor) || !descriptor.enumerable || !isDeepFrozenInertJson(descriptor.value, seen)) return false;
  }
  return true;
}

function deadLetterIdempotencyKey(source: Readonly<ShadowDurableRecord>): string {
  return shadowSpeculativeId('a2-dlq-key', {
    sourceRecordId: source.recordId,
    sourceIdempotencyKey: source.idempotencyKey,
  });
}

function envelopeResumeCursor(current: Readonly<ShadowDurableEnvelope>, recordId: string): string {
  return shadowSpeculativeId('a2-resume-cursor', {
    caseId: current.caseSnapshot.caseId,
    envelopeRevision: current.revision,
    recordId,
  });
}

function validateCapacity(capacity: Readonly<ShadowRecordCapacity>): void {
  assertClosedKeys(capacity, ['maximumRecords', 'criticalReserveRecords'], 'capacity');
  assertPositive(capacity.maximumRecords, 'capacity.maximumRecords');
  assertSafeNonNegative(capacity.criticalReserveRecords, 'capacity.criticalReserveRecords');
  if (capacity.maximumRecords > 4_096 || capacity.criticalReserveRecords > capacity.maximumRecords) {
    throw new TypeError('durable record capacity is invalid');
  }
}

function assertCapacityStable(current: Readonly<ShadowDurableEnvelope>, capacity: Readonly<ShadowRecordCapacity>): void {
  validateCapacity(capacity);
  if (
    (current.revision !== 0 || current.records.length !== 0)
    && digestValue(current.recordCapacity) !== digestValue(capacity)
  ) throw new TypeError('durable record capacity policy cannot be rebound');
}

function durableCompletionReservationSlots(records: readonly Readonly<ShadowDurableRecord>[]): number {
  let slots = 0;
  for (const source of records.filter((record) => record.kind === 'INBOX' || record.kind === 'OUTBOX' || record.kind === 'CASE')) {
    if (records.some((record) => record.kind === 'DLQ' && record.parentRecordId === source.recordId)) continue;
    const lastAttempt = records.filter((record) => record.kind === 'ATTEMPT' && record.parentRecordId === source.recordId).at(-1);
    if (lastAttempt === undefined) {
      slots += 2 * (SHADOW_DURABLE_ATTEMPT_LIMIT - source.attemptNumber) + 1;
    } else if (lastAttempt.attemptDisposition === 'STARTED') {
      slots += 2 * (SHADOW_DURABLE_ATTEMPT_LIMIT + 1 - lastAttempt.attemptNumber);
    } else if (lastAttempt?.attemptDisposition === 'FAILED_RETRYABLE') {
      slots += 2 * (SHADOW_DURABLE_ATTEMPT_LIMIT - lastAttempt.attemptNumber) + 1;
    } else if (lastAttempt?.attemptDisposition === 'FAILED_TERMINAL' || lastAttempt?.attemptDisposition === 'UNKNOWN') {
      slots += 1;
    }
  }
  return slots;
}

function caseEffectReadbackReservationSlots(snapshot: Readonly<ShadowCaseSnapshot>): number {
  let slots = 0;
  const keys = new Set(snapshot.effects.map((effect) => `${effect.generation}\0${effect.effectId}`));
  for (const key of keys) {
    const [generationText, effectId] = key.split('\0');
    const last = snapshot.effects.filter((effect) => (
      effect.generation === Number(generationText) && effect.effectId === effectId
    )).at(-1);
    if (last?.state === 'INTENT') slots += 2;
    else if (last?.state === 'UNKNOWN') slots += 1;
  }
  return slots;
}

function assertDurableCompletionCapacity(envelope: Readonly<ShadowDurableEnvelope>): void {
  const reservedSlots = durableCompletionReservationSlots(envelope.records);
  if (envelope.records.length + reservedSlots > envelope.recordCapacity.maximumRecords) {
    throw new RangeError('durable envelope strands reserved completion records');
  }
  if (envelope.caseSnapshot.attempts.length + reservedSlots > SHADOW_CASE_ATTEMPT_LEDGER_LIMIT) {
    throw new RangeError('durable envelope strands case attempt receipts');
  }
  const byteLength = Buffer.byteLength(canonicalJson(envelope), 'utf8');
  const reservedByteSlots = reservedSlots + caseEffectReadbackReservationSlots(envelope.caseSnapshot);
  if (byteLength + reservedByteSlots * RESERVED_COMPLETION_BYTES_PER_RECORD > MAX_DURABLE_ENVELOPE_BYTES) {
    throw new RangeError('durable envelope strands reserved completion bytes');
  }
}

function isEnvelopeCapacityError(error: unknown): error is RangeError {
  return error instanceof RangeError && (
    error.message === 'durable envelope exceeds canonical snapshot bound'
    || error.message === 'durable envelope strands reserved completion records'
    || error.message === 'durable envelope strands reserved completion bytes'
    || error.message === 'durable envelope strands case attempt receipts'
  );
}

function recordIdentity(input: Readonly<Omit<ShadowDurableRecord, 'recordId'>>): object {
  return {
    kind: input.kind,
    caseId: input.caseId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    generation: input.generation,
  };
}

function validateRecord(record: Readonly<ShadowDurableRecord>): void {
  assertClosedKeys(record, [
    'shadowStatus', 'recordId', 'kind', 'caseId', 'correlationId', 'idempotencyKey', 'payloadDigest',
    'generation', 'attemptNumber', 'parentRecordId', 'attemptDisposition', 'operationClass', 'priority', 'state', 'occurredAtMs',
  ], 'durable record');
  if (record.shadowStatus !== SHADOW_A2_STATUS) throw new TypeError('durable record status invalid');
  if (!(['INBOX', 'OUTBOX', 'DLQ', 'CASE', 'ATTEMPT', 'GLOBAL_EFFECT'] as const).includes(record.kind)) throw new TypeError('durable record kind invalid');
  if (!(['CRITICAL', 'NORMAL', 'COALESCIBLE'] as const).includes(record.priority)) throw new TypeError('durable record priority invalid');
  if (!(['PENDING', 'DELIVERED', 'DEAD_LETTERED', 'UNKNOWN'] as const).includes(record.state)) throw new TypeError('durable record state invalid');
  if (record.attemptDisposition !== null && !(['STARTED', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'UNKNOWN'] as const).includes(record.attemptDisposition)) {
    throw new TypeError('durable attempt disposition invalid');
  }
  if (record.kind === 'ATTEMPT' && (record.parentRecordId === null || record.attemptDisposition === null)) {
    throw new TypeError('attempt records require parent and disposition');
  }
  if (record.kind === 'ATTEMPT' && !(['DETERMINISTIC', 'PROVIDER', 'EVIDENCE_READ', 'HANDOFF', 'GLOBAL_EFFECT'] as const).includes(record.operationClass as 'PROVIDER')) {
    throw new TypeError('attempt records require an operation class');
  }
  if (record.kind !== 'ATTEMPT' && record.operationClass !== undefined) throw new TypeError('only attempt records carry an operation class');
  if (record.kind !== 'ATTEMPT' && record.attemptDisposition !== null) throw new TypeError('only attempt records carry attempt disposition');
  if (record.kind === 'ATTEMPT' && (record.state !== 'DELIVERED' || record.priority !== 'CRITICAL')) {
    throw new TypeError('attempt records must be immutable critical receipts');
  }
  if (record.kind === 'DLQ' && (record.state !== 'DEAD_LETTERED' || record.priority !== 'CRITICAL')) {
    throw new TypeError('dead-letter records must be immutable critical receipts');
  }
  if (record.kind === 'GLOBAL_EFFECT' && record.priority !== 'CRITICAL') {
    throw new TypeError('global-effect intents have owner-derived critical priority');
  }
  if ((record.kind === 'INBOX' || record.kind === 'OUTBOX' || record.kind === 'CASE') && record.priority === 'CRITICAL') {
    throw new TypeError('delivery source records cannot self-assert critical reserve priority');
  }
  if ((record.kind === 'INBOX' || record.kind === 'OUTBOX' || record.kind === 'CASE') && record.state !== 'PENDING') {
    throw new TypeError('delivery source records are append-only pending intents');
  }
  if (record.kind === 'GLOBAL_EFFECT' && record.state !== 'PENDING') {
    throw new TypeError('global-effect adapter records are intent-only');
  }
  assertIdentifier(record.recordId, 'record.recordId');
  assertIdentifier(record.caseId, 'record.caseId');
  assertIdentifier(record.correlationId, 'record.correlationId');
  assertIdentifier(record.idempotencyKey, 'record.idempotencyKey');
  if (record.parentRecordId !== null) assertIdentifier(record.parentRecordId, 'record.parentRecordId');
  assertDigest(record.payloadDigest, 'record.payloadDigest');
  assertSafeNonNegative(record.generation, 'record.generation');
  assertSafeNonNegative(record.attemptNumber, 'record.attemptNumber');
  assertUtc(record.occurredAtMs, 'record.occurredAtMs');
  const { recordId: _recordId, ...withoutId } = record;
  const expected = shadowSpeculativeId('a2-durable-record', recordIdentity(withoutId));
  if (record.recordId !== expected) throw new TypeError('durable record identity mismatch');
}

export function createDurableRecord(
  input: Readonly<Omit<ShadowDurableRecord, 'recordId' | 'shadowStatus'>>,
): Readonly<ShadowDurableRecord> {
  input = snapshotInertJson(input, 'durable record input') as Readonly<Omit<ShadowDurableRecord, 'recordId' | 'shadowStatus'>>;
  const candidate = Object.freeze({
    shadowStatus: SHADOW_A2_STATUS,
    ...input,
    recordId: shadowSpeculativeId('a2-durable-record', recordIdentity({ shadowStatus: SHADOW_A2_STATUS, ...input })),
  });
  validateRecord(candidate);
  return candidate;
}

export function createDurableEnvelope(
  snapshot: Readonly<ShadowCaseSnapshot>,
  revision = 0,
  records: readonly Readonly<ShadowDurableRecord>[] = [],
  recordCapacity: Readonly<ShadowRecordCapacity> = DEFAULT_SHADOW_RECORD_CAPACITY,
): Readonly<ShadowDurableEnvelope> {
  records = snapshotInertJson(records, 'durable envelope records') as readonly Readonly<ShadowDurableRecord>[];
  recordCapacity = snapshotInertJson(recordCapacity, 'durable envelope capacity') as Readonly<ShadowRecordCapacity>;
  assertSafeNonNegative(revision, 'revision');
  validateCapacity(recordCapacity);
  const sealedSnapshot = resumeCaseSnapshot(serializeCaseSnapshot(snapshot));
  if (!Array.isArray(records) || records.length > 4_096) throw new TypeError('durable record collection bound invalid');
  for (const record of records) validateRecord(record);
  const core = {
    schema: 'AI_OPS_A2_DURABLE_ENVELOPE_V1' as const,
    shadowStatus: SHADOW_A2_STATUS,
    revision,
    recordCapacity: Object.freeze({ ...recordCapacity }),
    caseSnapshot: sealedSnapshot,
    records: Object.freeze(records.map((record) => Object.freeze({ ...record }))),
  };
  const envelope = Object.freeze({ ...core, envelopeDigest: digestValue(core) });
  if (Buffer.byteLength(canonicalJson(envelope), 'utf8') > MAX_DURABLE_ENVELOPE_BYTES) {
    throw new RangeError('durable envelope exceeds canonical snapshot bound');
  }
  validateEnvelope(envelope);
  assertDurableCompletionCapacity(envelope);
  return envelope;
}

function validateEnvelope(rawEnvelope: Readonly<ShadowDurableEnvelope>): Readonly<ShadowDurableEnvelope> {
  const canPreserveIdentity = isDeepFrozenInertJson(rawEnvelope);
  const envelope = snapshotInertJson(rawEnvelope, 'durable envelope') as Readonly<ShadowDurableEnvelope>;
  assertClosedKeys(envelope, ['schema', 'shadowStatus', 'revision', 'recordCapacity', 'caseSnapshot', 'records', 'envelopeDigest'], 'durable envelope');
  if (envelope.schema !== 'AI_OPS_A2_DURABLE_ENVELOPE_V1' || envelope.shadowStatus !== SHADOW_A2_STATUS) throw new TypeError('durable envelope schema or status invalid');
  assertSafeNonNegative(envelope.revision, 'envelope.revision');
  validateCapacity(envelope.recordCapacity);
  assertDigest(envelope.envelopeDigest, 'envelope.envelopeDigest');
  serializeCaseSnapshot(envelope.caseSnapshot);
  if (!Array.isArray(envelope.records) || envelope.records.length > 4_096) throw new TypeError('durable envelope record bound invalid');
  const recordIds = new Set<string>();
  const idempotency = new Set<string>();
  for (let recordIndex = 0; recordIndex < envelope.records.length; recordIndex += 1) {
    const record = envelope.records[recordIndex];
    validateRecord(record);
    if (record.caseId !== envelope.caseSnapshot.caseId || record.generation > envelope.caseSnapshot.generation) {
      throw new TypeError('durable record case or generation isolation failed');
    }
    if (recordIds.has(record.recordId)) throw new TypeError('durable record IDs must be unique');
    recordIds.add(record.recordId);
    const key = `${record.kind}\0${record.idempotencyKey}`;
    if (idempotency.has(key)) throw new TypeError('durable idempotency keys must be unique per kind');
    idempotency.add(key);
    if (record.parentRecordId !== null) {
      const parentIndex = envelope.records.findIndex((candidate) => candidate.recordId === record.parentRecordId);
      const parent = parentIndex < 0 ? undefined : envelope.records[parentIndex];
      if (!parent) throw new TypeError('durable parent record is missing');
      if (parentIndex >= recordIndex) throw new TypeError('durable child record precedes its parent');
      if (record.kind === 'ATTEMPT' && parent.kind !== 'INBOX' && parent.kind !== 'OUTBOX' && parent.kind !== 'CASE') {
        throw new TypeError('durable attempt parent kind is unsupported');
      }
    }
  }
  for (const deadLetter of envelope.records.filter((record) => record.kind === 'DLQ')) {
    if (deadLetter.parentRecordId === null || deadLetter.state !== 'DEAD_LETTERED') {
      throw new TypeError('dead-letter record lineage invalid');
    }
    const original = envelope.records.find((record) => record.recordId === deadLetter.parentRecordId);
    if (!original || original.kind === 'ATTEMPT' || original.kind === 'DLQ' || original.kind === 'GLOBAL_EFFECT') {
      throw new TypeError('dead-letter original record is missing or unsupported');
    }
    const lastAttempt = envelope.records
      .filter((record) => record.kind === 'ATTEMPT' && record.parentRecordId === original.recordId)
      .sort((left, right) => left.attemptNumber - right.attemptNumber)
      .at(-1);
    if (
      deadLetter.payloadDigest !== original.payloadDigest
      || deadLetter.correlationId !== original.correlationId
      || deadLetter.generation !== original.generation
      || deadLetter.attemptNumber !== lastAttempt?.attemptNumber
      || deadLetter.idempotencyKey !== deadLetterIdempotencyKey(original)
      || deadLetter.priority !== 'CRITICAL'
      || !lastAttempt
      || !(['FAILED_RETRYABLE', 'FAILED_TERMINAL', 'UNKNOWN'] as const).includes(lastAttempt.attemptDisposition as 'FAILED_RETRYABLE' | 'FAILED_TERMINAL' | 'UNKNOWN')
      || (lastAttempt.attemptDisposition === 'FAILED_RETRYABLE' && lastAttempt.attemptNumber !== SHADOW_DURABLE_ATTEMPT_LIMIT)
      || deadLetter.occurredAtMs < lastAttempt.occurredAtMs
    ) throw new TypeError('dead-letter record does not prove source failure lineage');
    const redrives = envelope.records.filter((record) => record.parentRecordId === deadLetter.recordId);
    if (redrives.length > 1) {
      throw new TypeError('dead-letter redrive lineage invalid');
    }
    const redrive = redrives[0];
    const redriveSourceLastAttempt = original === undefined
      ? undefined
      : envelope.records.filter((record) => record.kind === 'ATTEMPT' && record.parentRecordId === original.recordId).at(-1);
    if (redrive && (
      redrive.kind !== original.kind
      || redrive.caseId !== original.caseId
      || redrive.correlationId !== original.correlationId
      || redrive.payloadDigest !== original.payloadDigest
      || redrive.generation !== original.generation
      || redrive.attemptNumber !== deadLetter.attemptNumber
      || redrive.priority !== original.priority
      || redrive.state !== 'PENDING'
      || redrive.occurredAtMs < deadLetter.occurredAtMs
      || !redriveSourceLastAttempt
      || !(['FAILED_TERMINAL', 'FAILED_RETRYABLE'] as const).includes(redriveSourceLastAttempt.attemptDisposition as 'FAILED_TERMINAL')
      || redriveSourceLastAttempt.attemptNumber >= SHADOW_DURABLE_ATTEMPT_LIMIT
    )) throw new TypeError('dead-letter redrive does not preserve source lineage');
  }
  for (const source of envelope.records.filter((record) => record.kind !== 'ATTEMPT' && record.kind !== 'DLQ')) {
    const attempts = envelope.records
      .filter((record) => record.kind === 'ATTEMPT' && record.parentRecordId === source.recordId);
    if (source.parentRecordId === null && source.attemptNumber !== 0) {
      throw new TypeError('root durable source cannot carry prior attempts');
    }
    if (source.parentRecordId !== null) {
      const parent = envelope.records.find((record) => record.recordId === source.parentRecordId);
      if (parent?.kind !== 'DLQ' || source.attemptNumber !== parent.attemptNumber || source.occurredAtMs < parent.occurredAtMs) {
        throw new TypeError('redriven durable source attempt baseline invalid');
      }
    }
    let previousAttemptTime = source.occurredAtMs;
    let expectedAttemptNumber = source.attemptNumber + 1;
    let awaitingOutcome = false;
    let reservationCount = source.attemptNumber;
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      if (
        attempt.caseId !== source.caseId
        || attempt.correlationId !== source.correlationId
        || attempt.generation !== source.generation
        || attempt.occurredAtMs < previousAttemptTime
        || attempt.payloadDigest !== digestValue({
          sourceRecordId: source.recordId,
          sourcePayloadDigest: source.payloadDigest,
          attemptNumber: attempt.attemptNumber,
          disposition: attempt.attemptDisposition,
          operationClass: attempt.operationClass,
        })
      ) throw new TypeError('durable attempt receipt does not preserve source lineage');
      if (!awaitingOutcome) {
        if (attempt.attemptDisposition !== 'STARTED' || attempt.attemptNumber !== expectedAttemptNumber) {
          throw new TypeError('durable attempt lineage is missing a contiguous STARTED reservation');
        }
        reservationCount += 1;
        if (reservationCount > SHADOW_DURABLE_ATTEMPT_LIMIT) throw new TypeError('durable attempt lineage exceeds the fixed shadow retry policy');
        awaitingOutcome = true;
      } else {
        if (attempt.attemptDisposition === 'STARTED' || attempt.attemptNumber !== expectedAttemptNumber) {
          throw new TypeError('durable attempt outcome does not resolve its reservation');
        }
        awaitingOutcome = false;
        if (attempt.attemptDisposition === 'FAILED_RETRYABLE') expectedAttemptNumber += 1;
        else if (index !== attempts.length - 1) throw new TypeError('durable attempt lineage continues after a terminal or ambiguous outcome');
      }
      previousAttemptTime = attempt.occurredAtMs;
    }
    const deadLetter = envelope.records.find((record) => record.kind === 'DLQ' && record.parentRecordId === source.recordId);
    if (deadLetter && attempts.some((attempt) => attempt.occurredAtMs > deadLetter.occurredAtMs)) {
      throw new TypeError('durable attempt was appended after dead-lettering');
    }
    if (
      source.kind !== 'GLOBAL_EFFECT'
      && source.generation < envelope.caseSnapshot.generation
      && deadLetter === undefined
      && attempts.at(-1)?.attemptDisposition !== 'SUCCEEDED'
    ) throw new TypeError('prior generation contains a stranded durable delivery obligation');
  }
  const { envelopeDigest: _digest, ...core } = envelope;
  if (digestValue(core) !== envelope.envelopeDigest) throw new TypeError('durable envelope digest mismatch');
  assertDurableCompletionCapacity(envelope);
  return canPreserveIdentity ? rawEnvelope : envelope;
}

function validateCaseLedgerReconciliation(envelope: Readonly<ShadowDurableEnvelope>): void {
  for (const attempt of envelope.caseSnapshot.attempts) {
    if (attempt.disposition === 'DEAD_LETTERED') {
      const deadLetter = envelope.records.find((record) => record.kind === 'DLQ' && record.recordId === attempt.attemptId);
      const source = deadLetter?.parentRecordId === null || deadLetter === undefined
        ? undefined
        : envelope.records.find((record) => record.recordId === deadLetter.parentRecordId);
      const lastDurableAttempt = source === undefined
        ? undefined
        : envelope.records.filter((record) => record.kind === 'ATTEMPT' && record.parentRecordId === source.recordId).at(-1);
      if (
        !deadLetter
        || !source
        || !lastDurableAttempt
        || attempt.sourceRecordId !== source.recordId
        || attempt.attemptBaseline !== source.attemptNumber
        || attempt.operationClass !== lastDurableAttempt.operationClass
        || attempt.generation !== deadLetter.generation
        || attempt.attemptNumber !== deadLetter.attemptNumber
        || attempt.recordedAtMs !== deadLetter.occurredAtMs
        || attempt.payloadDigest !== source.payloadDigest
      ) throw new TypeError('case dead-letter closure is not reconciled to its durable source');
      continue;
    }
    const durableAttempt = envelope.records.find((record) => record.kind === 'ATTEMPT' && record.idempotencyKey === attempt.attemptId);
    const source = durableAttempt?.parentRecordId === null || durableAttempt === undefined
      ? undefined
      : envelope.records.find((record) => record.recordId === durableAttempt.parentRecordId);
    if (
      !durableAttempt
      || !source
      || durableAttempt.parentRecordId !== attempt.sourceRecordId
      || attempt.attemptBaseline !== source.attemptNumber
      || durableAttempt.generation !== attempt.generation
      || durableAttempt.attemptNumber !== attempt.attemptNumber
      || durableAttempt.attemptDisposition !== attempt.disposition
      || durableAttempt.operationClass !== attempt.operationClass
      || durableAttempt.occurredAtMs !== attempt.recordedAtMs
      || source.payloadDigest !== attempt.payloadDigest
    ) throw new TypeError('case workflow attempt is not reconciled to a durable source and attempt receipt');
  }
  for (const durableAttempt of envelope.records.filter((record) => record.kind === 'ATTEMPT')) {
    const workflowAttempt = envelope.caseSnapshot.attempts.find((attempt) => attempt.attemptId === durableAttempt.idempotencyKey);
    const source = durableAttempt.parentRecordId === null
      ? undefined
      : envelope.records.find((record) => record.recordId === durableAttempt.parentRecordId);
    if (
      !workflowAttempt
      || !source
      || workflowAttempt.sourceRecordId !== durableAttempt.parentRecordId
      || workflowAttempt.attemptBaseline !== source.attemptNumber
      || workflowAttempt.generation !== durableAttempt.generation
      || workflowAttempt.attemptNumber !== durableAttempt.attemptNumber
      || workflowAttempt.disposition !== durableAttempt.attemptDisposition
      || workflowAttempt.operationClass !== durableAttempt.operationClass
      || workflowAttempt.recordedAtMs !== durableAttempt.occurredAtMs
    ) throw new TypeError('durable attempt receipt has no exact workflow attempt owner');
  }
  for (const deadLetter of envelope.records.filter((record) => record.kind === 'DLQ')) {
    const workflowClosure = envelope.caseSnapshot.attempts.find((attempt) => (
      attempt.attemptId === deadLetter.recordId && attempt.disposition === 'DEAD_LETTERED'
    ));
    if (!workflowClosure || workflowClosure.sourceRecordId !== deadLetter.parentRecordId) {
      throw new TypeError('durable dead-letter receipt has no exact workflow closure');
    }
  }
  const intentByEffectId = new Map(
    envelope.caseSnapshot.effects
      .filter((effect) => effect.state === 'INTENT')
      .map((effect) => [effect.effectId, effect] as const),
  );
  for (const [effectId, intent] of intentByEffectId) {
    const durableIntent = envelope.records.find((record) => record.kind === 'GLOBAL_EFFECT' && record.idempotencyKey === effectId);
    if (
      !durableIntent
      || durableIntent.payloadDigest !== intent.payloadDigest
      || durableIntent.generation !== intent.generation
      || durableIntent.occurredAtMs !== intent.recordedAtMs
    ) throw new TypeError('case global-effect intent is not reconciled to the durable adapter');
  }
  for (const durableIntent of envelope.records.filter((record) => record.kind === 'GLOBAL_EFFECT')) {
    const intent = intentByEffectId.get(durableIntent.idempotencyKey);
    if (!intent || intent.payloadDigest !== durableIntent.payloadDigest || intent.generation !== durableIntent.generation) {
      throw new TypeError('durable global-effect intent has no matching case intent');
    }
  }
}

function assertObjectSequenceRetained(
  previous: readonly Readonly<object>[],
  next: readonly Readonly<object>[],
  label: string,
): void {
  if (previous.length > next.length) throw new TypeError(`${label} dropped prior entries`);
  for (let index = 0; index < previous.length; index += 1) {
    if (digestValue(previous[index]) !== digestValue(next[index])) throw new TypeError(`${label} rewrote prior lineage`);
  }
}

function assertSnapshotReplacementMonotonic(
  previous: Readonly<ShadowCaseSnapshot>,
  next: Readonly<ShadowCaseSnapshot>,
): void {
  if (
    next.caseId !== previous.caseId
    || next.firstSeenAtMs !== previous.firstSeenAtMs
    || next.generation < previous.generation
    || next.generation > previous.generation + 1
    || next.revision < previous.revision
    || next.updatedAtMs < previous.updatedAtMs
    || next.compactedThroughRevision < previous.compactedThroughRevision
  ) throw new TypeError('durable snapshot replacement is stale or non-monotonic');
  if (next.generation > previous.generation && next.revision <= previous.revision) {
    throw new TypeError('durable snapshot generation advanced without an event revision');
  }
  if (next.compactedThroughRevision > previous.revision) {
    throw new TypeError('durable snapshot cannot append and compact uncommitted events in one replacement');
  }
  if (next.generation === previous.generation && next.revision === previous.revision) {
    if (
      next.state !== previous.state
      || next.updatedAtMs !== previous.updatedAtMs
      || next.events.at(-1)?.chainDigest !== previous.events.at(-1)?.chainDigest
      || digestValue(next.backpressure) !== digestValue(previous.backpressure)
    ) throw new TypeError('durable snapshot head changed without an event revision');
  }
  if (next.compactedThroughRevision > previous.compactedThroughRevision) {
    const boundary = previous.events.find((event) => event.revision === next.compactedThroughRevision);
    if (!boundary || next.compactedChainDigest !== boundary.chainDigest) {
      throw new TypeError('durable snapshot compaction boundary is not anchored in prior history');
    }
  } else if (next.compactedChainDigest !== previous.compactedChainDigest) {
    throw new TypeError('durable snapshot compaction digest changed without advancing its boundary');
  }
  for (const event of previous.events) {
    const retained = next.events.find((candidate) => candidate.revision === event.revision);
    if (retained && digestValue(retained) !== digestValue(event)) throw new TypeError('durable snapshot rewrote a prior event');
    if (event.revision > next.compactedThroughRevision && !retained) throw new TypeError('durable snapshot dropped an uncompacted event');
  }
  for (const receipt of previous.commandReceipts) {
    const retained = next.commandReceipts.find((candidate) => candidate.commandId === receipt.commandId);
    if (retained && digestValue(retained) !== digestValue(receipt)) throw new TypeError('durable snapshot rewrote a command receipt');
    if (!retained) throw new TypeError('durable snapshot dropped an exact command receipt');
  }
  assertObjectSequenceRetained(previous.attempts, next.attempts, 'durable snapshot attempt ledger');
  assertObjectSequenceRetained(previous.effects, next.effects, 'durable snapshot effect ledger');
  assertObjectSequenceRetained(previous.proofs, next.proofs, 'durable snapshot proof ledger');
  if (previous.budgetReceiptIds.some((id) => !next.budgetReceiptIds.includes(id))) {
    throw new TypeError('durable snapshot dropped a budget receipt');
  }
  if (previous.evidencePointerIds.some((id) => !next.evidencePointerIds.includes(id))) {
    throw new TypeError('durable snapshot dropped an evidence pointer');
  }
  if (next.generation === previous.generation) {
    if (previous.currentGenerationEvidencePointerIds.some((id) => !next.currentGenerationEvidencePointerIds.includes(id))) {
      throw new TypeError('durable snapshot dropped a current-generation evidence pointer');
    }
    if (
      previous.currentGenerationEvidenceBundleBinding !== null
      && digestValue(next.currentGenerationEvidenceBundleBinding) !== digestValue(previous.currentGenerationEvidenceBundleBinding)
    ) throw new TypeError('durable snapshot rewrote the evidence-bundle binding');
    if (
      previous.currentGenerationDiagnosticBinding !== null
      && digestValue(next.currentGenerationDiagnosticBinding) !== digestValue(previous.currentGenerationDiagnosticBinding)
    ) throw new TypeError('durable snapshot rewrote the diagnostic-result binding');
    if (next.diagnosticRoundCount < previous.diagnosticRoundCount) throw new TypeError('durable snapshot diagnostic round count regressed');
    if (previous.actionReadbackBinding !== null && digestValue(next.actionReadbackBinding) !== digestValue(previous.actionReadbackBinding)) {
      throw new TypeError('durable snapshot rewrote the action-readback binding');
    }
  } else if (
    next.currentGenerationEvidencePointerIds.length > 0
    || next.currentGenerationEvidenceBundleBinding !== null
    || next.currentGenerationDiagnosticBinding !== null
    || next.diagnosticRoundCount !== 0
    || next.actionReadbackBinding !== null
  ) {
    throw new TypeError('new case generation retained stale generation-scoped bindings');
  }
  if (next.backpressure.refusedCount < previous.backpressure.refusedCount) {
    throw new TypeError('durable snapshot backpressure count regressed');
  }
}

export type ShadowRecordAppendResult =
  | Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; status: 'APPENDED'; envelope: Readonly<ShadowDurableEnvelope> }>
  | Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; status: 'IDEMPOTENT'; envelope: Readonly<ShadowDurableEnvelope> }>
  | Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; status: 'BACKPRESSURED'; envelope: Readonly<ShadowDurableEnvelope>; resumeCursor: string }>;

export function appendDurableRecord(
  current: Readonly<ShadowDurableEnvelope>,
  record: Readonly<ShadowDurableRecord>,
  capacity: Readonly<ShadowRecordCapacity>,
): ShadowRecordAppendResult {
  current = validateEnvelope(current);
  record = snapshotInertJson(record, 'durable record append input') as Readonly<ShadowDurableRecord>;
  capacity = snapshotInertJson(capacity, 'durable append capacity') as Readonly<ShadowRecordCapacity>;
  validateRecord(record);
  validateCapacity(capacity);
  assertCapacityStable(current, capacity);
  if (record.kind === 'ATTEMPT' || record.kind === 'DLQ') throw new TypeError('attempt and DLQ records require their dedicated adapters');
  const existing = current.records.find((entry) => entry.recordId === record.recordId || (entry.kind === record.kind && entry.idempotencyKey === record.idempotencyKey));
  if (existing) {
    if (digestValue(existing) !== digestValue(record)) throw new TypeError('durable idempotency replay has conflicting content');
    return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'IDEMPOTENT', envelope: current });
  }
  if (record.caseId !== current.caseSnapshot.caseId || record.generation !== current.caseSnapshot.generation) {
    throw new TypeError('durable record belongs to a different case or stale generation');
  }
  if (record.occurredAtMs < current.caseSnapshot.updatedAtMs) throw new TypeError('durable record time must not precede the case head');
  const normalLimit = capacity.maximumRecords - capacity.criticalReserveRecords;
  const limit = record.priority === 'CRITICAL' ? capacity.maximumRecords : normalLimit;
  if (current.records.length >= limit) {
    return Object.freeze({
      shadowStatus: SHADOW_A2_STATUS,
      status: 'BACKPRESSURED',
      envelope: current,
      resumeCursor: envelopeResumeCursor(current, record.recordId),
    });
  }
  const candidateRecords = [...current.records, record];
  if (
    record.priority !== 'CRITICAL'
    && candidateRecords.length + durableCompletionReservationSlots(candidateRecords) > normalLimit
  ) {
    return Object.freeze({
      shadowStatus: SHADOW_A2_STATUS,
      status: 'BACKPRESSURED',
      envelope: current,
      resumeCursor: envelopeResumeCursor(current, record.recordId),
    });
  }
  let envelope: Readonly<ShadowDurableEnvelope>;
  try {
    envelope = createDurableEnvelope(current.caseSnapshot, current.revision + 1, candidateRecords, capacity);
  } catch (error) {
    if (!isEnvelopeCapacityError(error)) throw error;
    return Object.freeze({
      shadowStatus: SHADOW_A2_STATUS,
      status: 'BACKPRESSURED',
      envelope: current,
      resumeCursor: envelopeResumeCursor(current, record.recordId),
    });
  }
  return Object.freeze({
    shadowStatus: SHADOW_A2_STATUS,
    status: 'APPENDED',
    envelope,
  });
}

export type ShadowAttemptRecordResult =
  | Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; status: 'RECORDED' | 'IDEMPOTENT'; envelope: Readonly<ShadowDurableEnvelope> }>
  | Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; status: 'BACKPRESSURED'; envelope: Readonly<ShadowDurableEnvelope>; resumeCursor: string }>;

export function recordDurableAttempt(
  current: Readonly<ShadowDurableEnvelope>,
  sourceRecordId: string,
  attemptId: string,
  disposition: NonNullable<ShadowDurableRecord['attemptDisposition']>,
  atMs: number,
  capacity: Readonly<ShadowRecordCapacity>,
  maximumAttempts = 8,
  operationClass: 'DETERMINISTIC' | 'PROVIDER' | 'EVIDENCE_READ' | 'HANDOFF' | 'GLOBAL_EFFECT' = 'PROVIDER',
): ShadowAttemptRecordResult {
  current = validateEnvelope(current);
  capacity = snapshotInertJson(capacity, 'durable attempt capacity') as Readonly<ShadowRecordCapacity>;
  assertIdentifier(sourceRecordId, 'sourceRecordId');
  assertIdentifier(attemptId, 'attemptId');
  assertUtc(atMs, 'atMs');
  assertPositive(maximumAttempts, 'maximumAttempts');
  if (maximumAttempts !== SHADOW_DURABLE_ATTEMPT_LIMIT) throw new TypeError('maximum attempts must match the fixed shadow retry policy');
  if (!(['STARTED', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'UNKNOWN'] as const).includes(disposition)) throw new TypeError('attempt disposition invalid');
  if (!(['DETERMINISTIC', 'PROVIDER', 'EVIDENCE_READ', 'HANDOFF', 'GLOBAL_EFFECT'] as const).includes(operationClass)) throw new TypeError('attempt operation class invalid');
  const source = current.records.find((entry) => entry.recordId === sourceRecordId);
  if (!source || source.kind === 'ATTEMPT' || source.kind === 'DLQ' || source.kind === 'GLOBAL_EFFECT') {
    throw new TypeError('attempt source record is missing, unsupported, or effect-authority bearing');
  }
  const existing = current.records.find((entry) => entry.kind === 'ATTEMPT' && entry.idempotencyKey === attemptId);
  if (existing) {
    if (
      existing.parentRecordId !== sourceRecordId
      || existing.attemptDisposition !== disposition
      || existing.operationClass !== operationClass
      || existing.occurredAtMs !== atMs
      || existing.payloadDigest !== digestValue({
        sourceRecordId,
        sourcePayloadDigest: source.payloadDigest,
        attemptNumber: existing.attemptNumber,
        disposition,
        operationClass,
      })
    ) throw new TypeError('attempt ID replay has conflicting content');
    return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'IDEMPOTENT', envelope: current });
  }
  if (source.generation !== current.caseSnapshot.generation) throw new TypeError('stale generation durable attempt refused');
  if (atMs < current.caseSnapshot.updatedAtMs) throw new TypeError('durable attempt time must not precede the case head');
  if (source.state !== 'PENDING') throw new TypeError('only pending records can be attempted');
  if (current.records.some((entry) => entry.kind === 'DLQ' && entry.parentRecordId === source.recordId)) {
    throw new TypeError('dead-lettered durable record cannot be attempted again');
  }
  if (atMs < source.occurredAtMs) throw new TypeError('attempt time cannot precede source record');
  const sourceAttempts = current.records
    .filter((entry) => entry.kind === 'ATTEMPT' && entry.parentRecordId === source.recordId);
  const lastAttempt = sourceAttempts.at(-1);
  const reservationCount = source.attemptNumber + sourceAttempts.filter((attempt) => attempt.attemptDisposition === 'STARTED').length;
  let attemptNumber: number;
  if (!lastAttempt) {
    if (disposition !== 'STARTED') throw new TypeError('durable attempt lineage must begin with a persisted STARTED reservation');
    attemptNumber = source.attemptNumber + 1;
  } else if (lastAttempt.attemptDisposition === 'STARTED') {
    if (disposition === 'STARTED') throw new TypeError('durable attempt reservation requires an outcome before retry');
    if (lastAttempt.operationClass !== operationClass) throw new TypeError('durable attempt outcome changed the reserved operation class');
    attemptNumber = lastAttempt.attemptNumber;
  } else if (lastAttempt.attemptDisposition === 'FAILED_RETRYABLE') {
    if (disposition !== 'STARTED') throw new TypeError('retryable durable failure permits only the next STARTED reservation');
    attemptNumber = lastAttempt.attemptNumber + 1;
  } else {
    throw new TypeError('durable record cannot advance after a terminal or ambiguous outcome');
  }
  if (disposition === 'STARTED' && reservationCount >= maximumAttempts) throw new RangeError('durable record attempt budget exhausted');
  const receipt = createDurableRecord({
    kind: 'ATTEMPT',
    caseId: source.caseId,
    correlationId: source.correlationId,
    idempotencyKey: attemptId,
    payloadDigest: digestValue({ sourceRecordId, sourcePayloadDigest: source.payloadDigest, attemptNumber, disposition, operationClass }),
    generation: source.generation,
    attemptNumber,
    parentRecordId: source.recordId,
    attemptDisposition: disposition,
    operationClass,
    priority: 'CRITICAL',
    state: 'DELIVERED',
    occurredAtMs: atMs,
  });
  const caseSnapshot = recordAttempt(current.caseSnapshot, {
    attemptId,
    sourceRecordId,
    attemptBaseline: source.attemptNumber,
    operationClass,
    generation: source.generation,
    attemptNumber,
    disposition,
    recordedAtMs: atMs,
    payloadDigest: source.payloadDigest,
  });
  validateCapacity(capacity);
  assertCapacityStable(current, capacity);
  if (current.records.length >= capacity.maximumRecords) {
    return Object.freeze({
      shadowStatus: SHADOW_A2_STATUS,
      status: 'BACKPRESSURED',
      envelope: current,
      resumeCursor: envelopeResumeCursor(current, receipt.recordId),
    });
  }
  const records = [...current.records, receipt];
  let envelope: Readonly<ShadowDurableEnvelope>;
  try {
    envelope = createDurableEnvelope(caseSnapshot, current.revision + 1, records, capacity);
  } catch (error) {
    if (!isEnvelopeCapacityError(error)) throw error;
    return Object.freeze({
      shadowStatus: SHADOW_A2_STATUS,
      status: 'BACKPRESSURED',
      envelope: current,
      resumeCursor: envelopeResumeCursor(current, receipt.recordId),
    });
  }
  return Object.freeze({
    shadowStatus: SHADOW_A2_STATUS,
    status: 'RECORDED',
    envelope,
  });
}

export function moveRecordToDeadLetter(
  current: Readonly<ShadowDurableEnvelope>,
  recordId: string,
  atMs: number,
  maximumAttempts: number,
  capacity: Readonly<ShadowRecordCapacity>,
): ShadowRecordAppendResult {
  current = validateEnvelope(current);
  capacity = snapshotInertJson(capacity, 'durable dead-letter capacity') as Readonly<ShadowRecordCapacity>;
  validateCapacity(capacity);
  assertCapacityStable(current, capacity);
  assertIdentifier(recordId, 'recordId');
  assertUtc(atMs, 'atMs');
  assertPositive(maximumAttempts, 'maximumAttempts');
  if (maximumAttempts !== SHADOW_DURABLE_ATTEMPT_LIMIT) throw new TypeError('maximum attempts must match the fixed shadow retry policy');
  const source = current.records.find((entry) => entry.recordId === recordId);
  if (!source) throw new TypeError('durable record does not exist');
  const existing = current.records.find((entry) => entry.kind === 'DLQ' && entry.parentRecordId === recordId);
  if (existing) return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'IDEMPOTENT', envelope: current });
  if (source.generation !== current.caseSnapshot.generation) throw new TypeError('stale generation dead-letter transition refused');
  if (atMs < current.caseSnapshot.updatedAtMs) throw new TypeError('dead-letter time must not precede the case head');
  if (source.kind === 'ATTEMPT' || source.kind === 'DLQ' || source.kind === 'GLOBAL_EFFECT') throw new TypeError('durable record kind cannot be dead-lettered');
  if (source.state !== 'PENDING') throw new TypeError('only a pending durable record can be dead-lettered');
  if (atMs < source.occurredAtMs) throw new TypeError('dead-letter time cannot precede source record');
  const lastAttempt = current.records
    .filter((entry) => entry.kind === 'ATTEMPT' && entry.parentRecordId === source.recordId)
    .at(-1);
  if (!lastAttempt) throw new TypeError('dead-letter transition requires a failed attempt');
  if (lastAttempt.attemptDisposition === 'STARTED' || lastAttempt.attemptDisposition === 'SUCCEEDED') {
    throw new TypeError('dead-letter transition requires a failed or ambiguous outcome');
  }
  if (
    lastAttempt.attemptDisposition === 'FAILED_RETRYABLE'
    && lastAttempt.attemptNumber < maximumAttempts
  ) {
    throw new TypeError('durable record has not exhausted its attempts');
  }
  const deadLetter = createDurableRecord({
    kind: 'DLQ',
    caseId: source.caseId,
    correlationId: source.correlationId,
    idempotencyKey: deadLetterIdempotencyKey(source),
    payloadDigest: source.payloadDigest,
    generation: source.generation,
    attemptNumber: lastAttempt.attemptNumber,
    parentRecordId: source.recordId,
    attemptDisposition: null,
    priority: 'CRITICAL',
    state: 'DEAD_LETTERED',
    occurredAtMs: atMs,
  });
  if (current.records.length >= capacity.maximumRecords) {
    return Object.freeze({
      shadowStatus: SHADOW_A2_STATUS,
      status: 'BACKPRESSURED',
      envelope: current,
      resumeCursor: envelopeResumeCursor(current, deadLetter.recordId),
    });
  }
  const records = [...current.records, deadLetter];
  const caseSnapshot = recordAttempt(current.caseSnapshot, {
    attemptId: deadLetter.recordId,
    sourceRecordId: source.recordId,
    attemptBaseline: source.attemptNumber,
    operationClass: lastAttempt.operationClass as 'DETERMINISTIC' | 'PROVIDER' | 'EVIDENCE_READ' | 'HANDOFF' | 'GLOBAL_EFFECT',
    generation: source.generation,
    attemptNumber: lastAttempt.attemptNumber,
    disposition: 'DEAD_LETTERED',
    recordedAtMs: atMs,
    payloadDigest: source.payloadDigest,
  });
  let envelope: Readonly<ShadowDurableEnvelope>;
  try {
    envelope = createDurableEnvelope(caseSnapshot, current.revision + 1, records, capacity);
    envelope = validateEnvelope(envelope);
  } catch (error) {
    if (!isEnvelopeCapacityError(error)) throw error;
    return Object.freeze({
      shadowStatus: SHADOW_A2_STATUS,
      status: 'BACKPRESSURED',
      envelope: current,
      resumeCursor: envelopeResumeCursor(current, deadLetter.recordId),
    });
  }
  return Object.freeze({
    shadowStatus: SHADOW_A2_STATUS,
    status: 'APPENDED',
    envelope,
  });
}

export function redriveDeadLetter(
  current: Readonly<ShadowDurableEnvelope>,
  deadLetterRecordId: string,
  newIdempotencyKey: string,
  atMs: number,
  capacity: Readonly<ShadowRecordCapacity>,
  maximumAttempts = 8,
): ShadowRecordAppendResult {
  current = validateEnvelope(current);
  capacity = snapshotInertJson(capacity, 'durable redrive capacity') as Readonly<ShadowRecordCapacity>;
  assertIdentifier(deadLetterRecordId, 'deadLetterRecordId');
  assertIdentifier(newIdempotencyKey, 'newIdempotencyKey');
  assertUtc(atMs, 'atMs');
  assertPositive(maximumAttempts, 'maximumAttempts');
  if (maximumAttempts !== SHADOW_DURABLE_ATTEMPT_LIMIT) throw new TypeError('maximum attempts must match the fixed shadow retry policy');
  const deadLetter = current.records.find((entry) => entry.recordId === deadLetterRecordId && entry.kind === 'DLQ');
  if (!deadLetter || deadLetter.parentRecordId === null) throw new TypeError('dead-letter record is missing');
  const original = current.records.find((entry) => entry.recordId === deadLetter.parentRecordId);
  if (!original || original.kind === 'ATTEMPT' || original.kind === 'DLQ' || original.kind === 'GLOBAL_EFFECT') throw new TypeError('dead-letter original record is missing or unsupported');
  const existingRedrive = current.records.find((entry) => entry.parentRecordId === deadLetter.recordId && entry.kind === original.kind);
  if (existingRedrive?.idempotencyKey === newIdempotencyKey) {
    return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'IDEMPOTENT', envelope: current });
  }
  if (existingRedrive) throw new TypeError('dead-letter record was already redriven');
  if (original.generation !== current.caseSnapshot.generation) throw new TypeError('stale generation dead-letter redrive refused');
  assertCapacityStable(current, capacity);
  if (atMs < current.caseSnapshot.updatedAtMs) throw new TypeError('redrive time must not precede the case head');
  const lastAttempt = current.records
    .filter((entry) => entry.kind === 'ATTEMPT' && entry.parentRecordId === original.recordId)
    .sort((left, right) => left.attemptNumber - right.attemptNumber)
    .at(-1);
  if (!lastAttempt || !(['FAILED_TERMINAL', 'FAILED_RETRYABLE'] as const).includes(lastAttempt.attemptDisposition as 'FAILED_TERMINAL')) {
    throw new TypeError('redrive requires a proven failed attempt');
  }
  if (lastAttempt.attemptNumber >= maximumAttempts) throw new RangeError('redrive has no remaining authorized attempt budget');
  if (atMs < deadLetter.occurredAtMs) throw new TypeError('redrive time cannot precede dead-letter record');
  if (deadLetter.state !== 'DEAD_LETTERED') throw new TypeError('dead-letter record is not eligible for redrive');
  const appended = appendDurableRecord(current, createDurableRecord({
    kind: original.kind,
    caseId: original.caseId,
    correlationId: original.correlationId,
    idempotencyKey: newIdempotencyKey,
    payloadDigest: original.payloadDigest,
    generation: original.generation,
    attemptNumber: lastAttempt.attemptNumber,
    parentRecordId: deadLetter.recordId,
    attemptDisposition: null,
    priority: original.priority,
    state: 'PENDING',
    occurredAtMs: atMs,
  }), capacity);
  return appended;
}

function replayDurableRecordAppend(
  current: Readonly<ShadowDurableEnvelope>,
  expectedRecord: Readonly<ShadowDurableRecord>,
  capacity: Readonly<ShadowRecordCapacity>,
): Readonly<ShadowDurableEnvelope> {
  let result: ShadowRecordAppendResult | ShadowAttemptRecordResult;
  if (expectedRecord.kind === 'ATTEMPT') {
    if (expectedRecord.parentRecordId === null || expectedRecord.attemptDisposition === null) {
      throw new TypeError('attempt replay is missing its immutable lineage');
    }
    result = recordDurableAttempt(
      current,
      expectedRecord.parentRecordId,
      expectedRecord.idempotencyKey,
      expectedRecord.attemptDisposition,
      expectedRecord.occurredAtMs,
      capacity,
      SHADOW_DURABLE_ATTEMPT_LIMIT,
      expectedRecord.operationClass,
    );
  } else if (expectedRecord.kind === 'DLQ') {
    if (expectedRecord.parentRecordId === null) throw new TypeError('dead-letter replay is missing its source');
    result = moveRecordToDeadLetter(
      current,
      expectedRecord.parentRecordId,
      expectedRecord.occurredAtMs,
      SHADOW_DURABLE_ATTEMPT_LIMIT,
      capacity,
    );
  } else if (expectedRecord.parentRecordId !== null) {
    result = redriveDeadLetter(
      current,
      expectedRecord.parentRecordId,
      expectedRecord.idempotencyKey,
      expectedRecord.occurredAtMs,
      capacity,
      SHADOW_DURABLE_ATTEMPT_LIMIT,
    );
  } else {
    result = appendDurableRecord(current, expectedRecord, capacity);
  }
  if (result.status === 'BACKPRESSURED') throw new RangeError('durable record suffix exceeds configured persistence capacity');
  if (result.status === 'IDEMPOTENT') throw new TypeError('durable record suffix replays existing content');
  const actualRecord = result.envelope.records.at(-1);
  if (actualRecord === undefined || digestValue(actualRecord) !== digestValue(expectedRecord)) {
    throw new TypeError('durable record suffix does not match canonical adapter replay');
  }
  return result.envelope;
}

function assertDurableRecordSuffixReplay(
  base: Readonly<ShadowDurableEnvelope>,
  target: Readonly<ShadowDurableEnvelope>,
  capacity: Readonly<ShadowRecordCapacity>,
  requireExactRevision: boolean,
): void {
  validateCapacity(capacity);
  assertObjectSequenceRetained(base.records, target.records, 'durable record ledger');
  let replayed = base;
  for (const record of target.records.slice(base.records.length)) {
    replayed = replayDurableRecordAppend(replayed, record, capacity);
  }
  if (digestValue(replayed.records) !== digestValue(target.records)) {
    throw new TypeError('durable record suffix differs from canonical adapter replay');
  }
  if (requireExactRevision && replayed.revision !== target.revision) {
    throw new TypeError('durable envelope revision does not match canonical record append count');
  }
  if (!requireExactRevision && target.records.length > base.records.length && replayed.revision !== target.revision) {
    throw new TypeError('durable envelope replacement contains more than one record append');
  }
}

/** Structural subset of the existing Ledger port; A2 cannot construct the owner. */
export interface ShadowCanonicalPersistencePort {
  getConfigValue(key: string): string | null;
  compareAndSetConfigValueAndLogEvents?(
    key: string,
    expectedValue: string | null,
    nextValue: string,
    records: readonly LedgerEventInputRecord[],
    commitBeforeMs?: number,
  ): LedgerConfigCompareAndSetResult;
}

export interface ShadowSyntheticPersistenceBinding {
  readonly posture: 'SYNTHETIC_ONLY';
  readonly configKey: string;
  readonly eventKind: string;
  readonly recordCapacity: Readonly<ShadowRecordCapacity>;
  readonly port: ShadowCanonicalPersistencePort;
}

function capturePersistenceMethod<T extends (...args: never[]) => unknown>(
  port: Readonly<ShadowCanonicalPersistencePort>,
  name: 'getConfigValue' | 'compareAndSetConfigValueAndLogEvents',
  required: boolean,
): T | null {
  if (typeof port !== 'object' || port === null) throw new TypeError('canonical persistence port must be an object');
  let cursor: object | null = port;
  while (cursor !== null && cursor !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, name);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') throw new TypeError(`canonical persistence ${name} must be an inert method`);
      return descriptor.value.bind(port) as T;
    }
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  if (required) throw new TypeError(`canonical persistence ${name} is unavailable`);
  return null;
}

export type ShadowPersistenceCommitResult =
  | Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; status: 'COMMITTED'; serialized: string }>
  | Readonly<{ shadowStatus: typeof SHADOW_A2_STATUS; status: 'VERSION_CONFLICT' | 'DEADLINE_EXCEEDED' | 'BINDING_UNAVAILABLE'; serialized: null }>;

export function commitDurableEnvelope(
  binding: Readonly<ShadowSyntheticPersistenceBinding>,
  expectedSerialized: string | null,
  envelope: Readonly<ShadowDurableEnvelope>,
  commitBeforeMs: number,
  proofVerifier: Readonly<ShadowCaseProofVerifierPort>,
): ShadowPersistenceCommitResult {
  if (binding.posture !== 'SYNTHETIC_ONLY') throw new TypeError('A2 shadow persistence binding must remain synthetic-only');
  assertClosedKeys(binding, ['posture', 'configKey', 'eventKind', 'recordCapacity', 'port'], 'persistence binding');
  const configKey = binding.configKey;
  const eventKind = binding.eventKind;
  const recordCapacity = snapshotInertJson(binding.recordCapacity, 'persistence binding capacity') as Readonly<ShadowRecordCapacity>;
  const compareAndSet = capturePersistenceMethod<NonNullable<ShadowCanonicalPersistencePort['compareAndSetConfigValueAndLogEvents']>>(
    binding.port,
    'compareAndSetConfigValueAndLogEvents',
    false,
  );
  // Owner proof verification is callback-bearing. Snapshot the complete target
  // before invoking it so a caller closure cannot swap the bytes committed by CAS.
  envelope = snapshotInertJson(envelope, 'durable envelope commit target') as Readonly<ShadowDurableEnvelope>;
  assertIdentifier(configKey, 'binding.configKey');
  if (!/^[a-z][a-z0-9._-]{0,63}$/u.test(eventKind)) throw new TypeError('binding.eventKind is invalid');
  validateCapacity(recordCapacity);
  assertUtc(commitBeforeMs, 'commitBeforeMs');
  envelope = validateEnvelope(envelope);
  if (digestValue(envelope.recordCapacity) !== digestValue(recordCapacity)) throw new TypeError('persistence binding capacity does not match the durable envelope');
  validateCaseLedgerReconciliation(envelope);
  let expectedEnvelope: Readonly<ShadowDurableEnvelope> | null = null;
  if (expectedSerialized !== null) {
    if (typeof expectedSerialized !== 'string' || Buffer.byteLength(expectedSerialized, 'utf8') > 512 * 1024) throw new TypeError('expected durable envelope token is invalid or oversized');
    let parsed: unknown;
    try {
      parsed = JSON.parse(expectedSerialized);
    } catch {
      throw new TypeError('expected durable envelope token is invalid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new TypeError('expected durable envelope token must contain an object');
    expectedEnvelope = parsed as ShadowDurableEnvelope;
    expectedEnvelope = validateEnvelope(expectedEnvelope);
    if (canonicalJson(expectedEnvelope) !== expectedSerialized) throw new TypeError('expected durable envelope token must be canonical');
    if (digestValue(expectedEnvelope.recordCapacity) !== digestValue(envelope.recordCapacity)) throw new TypeError('durable envelope capacity policy changed across CAS');
    if (envelope.revision <= expectedEnvelope.revision) throw new TypeError('durable envelope replacement revision did not advance');
    if (
      envelope.records.length === expectedEnvelope.records.length
      && envelope.revision !== expectedEnvelope.revision + 1
    ) throw new TypeError('snapshot-only durable replacement revision is not contiguous');
    assertSnapshotReplacementMonotonic(expectedEnvelope.caseSnapshot, envelope.caseSnapshot);
    assertCaseSnapshotSuccessorForPersistence(expectedEnvelope.caseSnapshot, envelope.caseSnapshot, proofVerifier);
    assertDurableRecordSuffixReplay(expectedEnvelope, envelope, recordCapacity, false);
    if (expectedEnvelope.caseSnapshot.snapshotDigest === envelope.caseSnapshot.snapshotDigest && expectedEnvelope.records.length === envelope.records.length) {
      throw new TypeError('durable envelope replacement is a no-op');
    }
  } else {
    assertInitialCaseSnapshotForPersistence(envelope.caseSnapshot, proofVerifier);
    const empty = createDurableEnvelope(envelope.caseSnapshot, 0, [], envelope.recordCapacity);
    assertDurableRecordSuffixReplay(empty, envelope, recordCapacity, true);
  }
  const serialized = canonicalJson(envelope);
  if (Buffer.byteLength(serialized, 'utf8') > 512 * 1024) throw new RangeError('durable envelope exceeds canonical snapshot bound');
  if (compareAndSet === null) {
    return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'BINDING_UNAVAILABLE', serialized: null });
  }
  const auditRecord = Object.freeze({
    kind: eventKind,
    symbol: null,
    data: Object.freeze({
      schema: 'AI_OPS_A2_SHADOW_PERSISTENCE_AUDIT_V1',
      shadowStatus: SHADOW_A2_STATUS,
      caseId: envelope.caseSnapshot.caseId,
      envelopeRevision: envelope.revision,
      envelopeDigest: envelope.envelopeDigest,
    }),
  });
  const rawResult = compareAndSet(
    configKey,
    expectedSerialized,
    serialized,
    [auditRecord],
    commitBeforeMs,
  );
  const result = snapshotInertJson(rawResult, 'canonical persistence CAS result') as LedgerConfigCompareAndSetResult;
  if (result.committed === false) {
    assertClosedKeys(result, ['committed', 'reason', 'currentValue'], 'canonical persistence refusal');
    if (!(['VERSION_CONFLICT', 'DEADLINE_EXCEEDED'] as const).includes(result.reason)) throw new TypeError('canonical persistence returned an unsupported refusal reason');
    if (result.currentValue !== null && typeof result.currentValue !== 'string') throw new TypeError('canonical persistence refusal current value is invalid');
    return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: result.reason, serialized: null });
  }
  if (result.committed !== true) throw new TypeError('canonical persistence returned a non-boolean commit disposition');
  assertClosedKeys(result, ['committed', 'events'], 'canonical persistence commit receipt');
  if (!Array.isArray(result.events) || result.events.length !== 1) throw new TypeError('canonical persistence commit receipt must contain one audit event');
  const event = result.events[0];
  assertClosedKeys(event, ['id', 'ts', 'kind', 'symbol', 'data'], 'canonical persistence audit event');
  assertPositive(event.id, 'canonical persistence audit event ID');
  assertUtc(event.ts, 'canonical persistence audit event time');
  if (event.ts >= commitBeforeMs) throw new TypeError('canonical persistence audit event missed the commit deadline');
  if (event.kind !== auditRecord.kind || event.symbol !== null || digestValue(event.data) !== digestValue(auditRecord.data)) {
    throw new TypeError('canonical persistence audit event does not match the committed envelope');
  }
  return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, status: 'COMMITTED', serialized });
}

export function readDurableEnvelope(
  binding: Readonly<ShadowSyntheticPersistenceBinding>,
  proofVerifier: Readonly<ShadowCaseProofVerifierPort>,
  maximumBytes = 512 * 1024,
): Readonly<ShadowDurableEnvelope> | null {
  if (binding.posture !== 'SYNTHETIC_ONLY') throw new TypeError('A2 shadow persistence binding must remain synthetic-only');
  assertClosedKeys(binding, ['posture', 'configKey', 'eventKind', 'recordCapacity', 'port'], 'persistence binding');
  const configKey = binding.configKey;
  const eventKind = binding.eventKind;
  const recordCapacity = snapshotInertJson(binding.recordCapacity, 'persistence binding capacity') as Readonly<ShadowRecordCapacity>;
  const getConfigValue = capturePersistenceMethod<ShadowCanonicalPersistencePort['getConfigValue']>(binding.port, 'getConfigValue', true) as ShadowCanonicalPersistencePort['getConfigValue'];
  assertIdentifier(configKey, 'binding.configKey');
  if (!/^[a-z][a-z0-9._-]{0,63}$/u.test(eventKind)) throw new TypeError('binding.eventKind is invalid');
  validateCapacity(recordCapacity);
  assertPositive(maximumBytes, 'maximumBytes');
  const serialized = getConfigValue(configKey);
  if (serialized === null) return null;
  if (typeof serialized !== 'string') throw new TypeError('durable envelope owner returned a non-string value');
  if (Buffer.byteLength(serialized, 'utf8') > maximumBytes) throw new TypeError('durable envelope exceeds its read bound');
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new TypeError('durable envelope is invalid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('durable envelope must be an object');
  const parsed = validateEnvelope(value as ShadowDurableEnvelope);
  if (digestValue(parsed.recordCapacity) !== digestValue(recordCapacity)) {
    throw new TypeError('persistence binding capacity does not match the durable envelope');
  }
  validateCaseLedgerReconciliation(parsed);
  assertCaseSnapshotProofsForPersistence(parsed.caseSnapshot, proofVerifier);
  const snapshot = resumeCaseSnapshot(canonicalJson(parsed.caseSnapshot), maximumBytes);
  const rebuilt = createDurableEnvelope(snapshot, parsed.revision, parsed.records, parsed.recordCapacity);
  if (rebuilt.envelopeDigest !== parsed.envelopeDigest) throw new TypeError('durable envelope reconstruction mismatch');
  return rebuilt;
}
