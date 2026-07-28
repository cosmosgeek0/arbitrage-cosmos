import {
  canonicalJson,
  stableHash128Hex,
} from '../../foundation/contracts/index.js';
import { types as utilTypes } from 'node:util';
import {
  reconcileVolumeStrategyLocal,
  replayVolumeStrategyEvaluation,
  validateVolumeStrategyLocalReconciliation,
  validateVolumeStrategyEvaluation,
  validateVolumeValidateOnlyPlan,
  type VolumeStrategyEvaluation,
  type VolumeStrategyLocalReconciliation,
  type VolumeValidateOnlyPlan,
} from './strategySlice.js';

export const VOLUME_STRATEGY_CONFIG_KEY = 'volume.strategy-slice.v1' as const;
export const VOLUME_STRATEGY_EVALUATED_EVENT_KIND = 'volume.strategy.evaluated' as const;
export const VOLUME_STRATEGY_RECONCILED_EVENT_KIND = 'volume.strategy.reconciled' as const;

const CHECKPOINT_SCHEMA = 'cosmos.engine.volume.strategy-slice.checkpoint.v1' as const;
const CHECKPOINT_SCHEMA_VERSION = 1 as const;
const EVALUATED_EVENT_SCHEMA = 'cosmos.engine.volume.strategy-slice.evaluated.v1' as const;
const RECONCILED_EVENT_SCHEMA = 'cosmos.engine.volume.strategy-slice.reconciled.v1' as const;
const CHECKPOINT_MAX_BYTES = 256 * 1024;
const CHECKPOINT_KEYS = Object.freeze([
  'checksum',
  'lastEvaluation',
  'lastPlan',
  'localReconciliation',
  'revision',
  'schema',
  'schemaVersion',
]);
const LEDGER_EVENT_KEYS = Object.freeze([
  'correlation',
  'createdAt',
  'data',
  'id',
  'kind',
  'message',
  'reason',
  'severity',
  'source',
  'status',
  'strategy',
  'symbol',
  'ts',
]);

export interface VolumeStrategyLedgerEventInput {
  readonly kind: string;
  readonly symbol?: string | null;
  readonly data?: unknown;
  readonly severity?: string | null;
  readonly source?: string | null;
  readonly strategy?: string | null;
  readonly status?: string | null;
  readonly reason?: string | null;
  readonly message?: string | null;
  readonly correlation?: string | null;
  readonly createdAt?: number;
}

export interface VolumeStrategyLedgerEventRecord {
  readonly id: number;
  readonly ts: number;
  readonly kind: string;
  readonly symbol: string | null;
  readonly data: unknown;
  readonly severity: string | null;
  readonly source: string | null;
  readonly strategy: string | null;
  readonly status: string | null;
  readonly reason: string | null;
  readonly message: string | null;
  readonly correlation: string | null;
  readonly createdAt: number;
}

export type VolumeStrategyLedgerCasResult =
  | {
      readonly committed: true;
      readonly events: readonly VolumeStrategyLedgerEventRecord[];
    }
  | {
      readonly committed: false;
      readonly reason: 'VERSION_CONFLICT' | 'DEADLINE_EXCEEDED';
      readonly currentValue: string | null;
    };

/** Structural subset implemented by the sole canonical Ledger owner. */
export interface VolumeStrategyLedgerPort {
  readonly getConfigValue: (key: string) => string | null;
  readonly compareAndSetConfigValueAndLogEvents: (
    key: string,
    expectedValue: string | null,
    nextValue: string,
    records: readonly VolumeStrategyLedgerEventInput[],
    commitBeforeMs?: number,
  ) => VolumeStrategyLedgerCasResult;
}

export interface VolumeStrategyCheckpoint {
  readonly schema: typeof CHECKPOINT_SCHEMA;
  readonly schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  readonly revision: number;
  readonly checksum: string;
  readonly lastEvaluation: Readonly<VolumeStrategyEvaluation>;
  readonly lastPlan: Readonly<VolumeValidateOnlyPlan>;
  readonly localReconciliation: Readonly<VolumeStrategyLocalReconciliation>;
}

export type VolumeStrategyCheckpointLoad = Readonly<
  | {
      status: 'EMPTY';
      serialized: null;
      checkpoint: null;
      reasonCode: null;
    }
  | {
      status: 'AVAILABLE';
      serialized: string;
      checkpoint: Readonly<VolumeStrategyCheckpoint>;
      reasonCode: null;
    }
  | {
      status: 'CORRUPT';
      serialized: string;
      checkpoint: null;
      reasonCode: 'VOLUME_STRATEGY_LEDGER_CORRUPT';
    }
  | {
      status: 'UNAVAILABLE';
      serialized: null;
      checkpoint: null;
      reasonCode: 'VOLUME_STRATEGY_LEDGER_UNAVAILABLE';
    }
>;

export type VolumeStrategyCheckpointCommit = Readonly<
  | {
      disposition: 'COMMITTED_NEW' | 'ALREADY_COMMITTED';
      checkpoint: Readonly<VolumeStrategyCheckpoint>;
      eventIds: readonly number[];
      reasonCode: null;
    }
  | {
      disposition:
        | 'INVALID_REQUEST'
        | 'IDENTITY_CONFLICT'
        | 'VERSION_CONFLICT'
        | 'DEADLINE_EXCEEDED'
        | 'PERSISTENCE_CORRUPT'
        | 'PERSISTENCE_UNAVAILABLE'
        | 'COMMIT_READBACK_INVALID';
      checkpoint: null;
      eventIds: readonly [];
      reasonCode: string;
      current: VolumeStrategyCheckpointLoad;
    }
>;

export interface VolumeStrategyCheckpointCommitInput {
  readonly expected: Readonly<Extract<
    VolumeStrategyCheckpointLoad,
    { status: 'EMPTY' | 'AVAILABLE' }
  >>;
  readonly evaluation: Readonly<VolumeStrategyEvaluation>;
  readonly commitBeforeMs?: number;
}

export type VolumeStrategyLedgerRestoreResult = Readonly<
  | {
      status: 'EMPTY';
      checkpoint: null;
      reasonCode: null;
    }
  | {
      status: 'RESTORED';
      checkpoint: Readonly<VolumeStrategyCheckpoint>;
      reasonCode: null;
    }
  | {
      status: 'CORRUPT' | 'UNAVAILABLE';
      checkpoint: null;
      reasonCode: string;
    }
>;

export type VolumeStrategyLedgerCoordinatorSnapshot = Readonly<
  | {
      status: 'EMPTY';
      checkpoint: null;
      reasonCode: null;
    }
  | {
      status: 'AVAILABLE';
      checkpoint: Readonly<VolumeStrategyCheckpoint>;
      reasonCode: null;
    }
  | {
      status: 'BLOCKED';
      checkpoint: null;
      reasonCode: string;
    }
>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
    return null;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string')) return null;
    const actual = (ownKeys as string[]).sort(compareText);
    const expected = [...keys].sort(compareText);
    if (actual.some((key, index) => key !== expected[index])) return null;
    for (const key of actual) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

interface DataSnapshotState {
  nodes: number;
  readonly seen: WeakSet<object>;
}

function ownDataSnapshot(value: unknown, state: DataSnapshotState, depth = 0): unknown {
  state.nodes += 1;
  if (state.nodes > 20_000 || depth > 32) throw new TypeError('data envelope exceeds its bound');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > CHECKPOINT_MAX_BYTES) throw new TypeError('string exceeds its bound');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError('invalid numeric value');
    return value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value)) {
    throw new TypeError('ordinary data value required');
  }
  if (state.seen.has(value)) throw new TypeError('cyclic data is not supported');
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('ordinary array required');
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 4_096) {
        throw new TypeError('array exceeds its bound');
      }
      const expectedKeys = new Set([
        'length',
        ...Array.from({ length }, (_, index) => String(index)),
      ]);
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== expectedKeys.size
          || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))) {
        throw new TypeError('dense data array required');
      }
      const snapshot: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
          throw new TypeError('array accessors are not supported');
        }
        snapshot.push(ownDataSnapshot(descriptor.value, state, depth + 1));
      }
      return snapshot;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('ordinary data object required');
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > 256 || ownKeys.some((key) => typeof key !== 'string')) {
      throw new TypeError('object exceeds its bound');
    }
    const snapshot: Record<string, unknown> = {};
    for (const key of (ownKeys as string[]).sort(compareText)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new TypeError('unsafe object key');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        throw new TypeError('object accessors are not supported');
      }
      snapshot[key] = ownDataSnapshot(descriptor.value, state, depth + 1);
    }
    return snapshot;
  } finally {
    state.seen.delete(value);
  }
}

function safeCanonical(value: unknown): string | null {
  try {
    return canonicalJson(ownDataSnapshot(value, { nodes: 0, seen: new WeakSet<object>() }));
  } catch {
    return null;
  }
}

function canonicalSnapshot<T>(value: T): T | null {
  const serialized = safeCanonical(value);
  if (serialized === null) return null;
  try {
    return deepFreeze(JSON.parse(serialized) as T);
  } catch {
    return null;
  }
}

function sameCanonical(left: unknown, right: unknown): boolean {
  const leftCanonical = safeCanonical(left);
  return leftCanonical !== null && leftCanonical === safeCanonical(right);
}

function validRevision(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    && !Object.is(value, -0);
}

function validCommitDeadline(value: unknown): value is number | undefined {
  return value === undefined
    || (typeof value === 'number'
      && Number.isSafeInteger(value)
      && value >= 0
      && !Object.is(value, -0));
}

function normalizeEvaluation(
  value: unknown,
): Readonly<VolumeStrategyEvaluation> | null {
  if (!validateVolumeStrategyEvaluation(value)) return null;
  const replay = replayVolumeStrategyEvaluation(value);
  if (replay.status !== 'EXACT' || replay.evaluation === null) return null;
  const snapshot = canonicalSnapshot(replay.evaluation);
  if (snapshot === null || !validateVolumeStrategyEvaluation(snapshot)) return null;
  const replayed = replayVolumeStrategyEvaluation(snapshot);
  return replayed.status === 'EXACT' ? replayed.evaluation : null;
}

function normalizePlan(value: unknown): Readonly<VolumeValidateOnlyPlan> | null {
  if (!validateVolumeValidateOnlyPlan(value)) return null;
  const snapshot = canonicalSnapshot(value);
  return snapshot !== null && validateVolumeValidateOnlyPlan(snapshot) ? snapshot : null;
}

function normalizeReconciliation(
  value: unknown,
): Readonly<VolumeStrategyLocalReconciliation> | null {
  if (!validateVolumeStrategyLocalReconciliation(value)) return null;
  const snapshot = canonicalSnapshot(value);
  return snapshot !== null && validateVolumeStrategyLocalReconciliation(snapshot) ? snapshot : null;
}

function checkpointPayload(
  revision: number,
  evaluation: Readonly<VolumeStrategyEvaluation>,
  plan: Readonly<VolumeValidateOnlyPlan>,
  reconciliation: Readonly<VolumeStrategyLocalReconciliation>,
): Omit<VolumeStrategyCheckpoint, 'checksum'> {
  return Object.freeze({
    schema: CHECKPOINT_SCHEMA,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    revision,
    lastEvaluation: evaluation,
    lastPlan: plan,
    localReconciliation: reconciliation,
  });
}

function createCheckpoint(
  revision: number,
  evaluationValue: unknown,
): Readonly<VolumeStrategyCheckpoint> | null {
  if (!validRevision(revision)) return null;
  const evaluation = normalizeEvaluation(evaluationValue);
  if (evaluation === null) return null;
  const plan = normalizePlan(evaluation.plan);
  if (plan === null || !sameCanonical(plan, evaluation.plan)) return null;
  const reconciliation = normalizeReconciliation(
    reconcileVolumeStrategyLocal(evaluation, evaluation),
  );
  if (reconciliation === null
      || reconciliation.status !== 'EXACT'
      || reconciliation.expectedEvaluationId !== evaluation.evaluationId
      || reconciliation.persistedEvaluationId !== evaluation.evaluationId
      || reconciliation.expectedPlanId !== plan.planId
      || reconciliation.persistedPlanId !== plan.planId) return null;
  const payload = checkpointPayload(revision, evaluation, plan, reconciliation);
  const checksum = `vcheckpoint_${stableHash128Hex(canonicalJson(payload))}`;
  return deepFreeze({ ...payload, checksum });
}

function normalizeCheckpointSnapshot(value: unknown): Readonly<VolumeStrategyCheckpoint> | null {
  const record = exactRecord(value, CHECKPOINT_KEYS);
  if (record === null
      || record.schema !== CHECKPOINT_SCHEMA
      || record.schemaVersion !== CHECKPOINT_SCHEMA_VERSION
      || !validRevision(record.revision)
      || typeof record.checksum !== 'string'
      || !/^vcheckpoint_[a-f0-9]{32}$/.test(record.checksum)
      || !validateVolumeStrategyEvaluation(record.lastEvaluation)
      || !validateVolumeValidateOnlyPlan(record.lastPlan)
      || !validateVolumeStrategyLocalReconciliation(record.localReconciliation)) return null;
  const replay = replayVolumeStrategyEvaluation(record.lastEvaluation);
  if (replay.status !== 'EXACT' || replay.evaluation === null) return null;
  const rebuilt = createCheckpoint(record.revision, replay.evaluation);
  if (rebuilt === null
      || rebuilt.checksum !== record.checksum
      || !sameCanonical(rebuilt, value)) return null;
  return rebuilt;
}

export function encodeVolumeStrategyCheckpoint(
  checkpoint: Readonly<VolumeStrategyCheckpoint>,
): string {
  const snapshot = canonicalSnapshot<unknown>(checkpoint);
  const rebuilt = snapshot === null ? null : normalizeCheckpointSnapshot(snapshot);
  if (rebuilt === null) {
    throw new TypeError('Volume strategy checkpoint is invalid or diverged');
  }
  const serialized = canonicalJson(rebuilt);
  if (Buffer.byteLength(serialized, 'utf8') > CHECKPOINT_MAX_BYTES) {
    throw new RangeError('Volume strategy checkpoint exceeds its bounded envelope');
  }
  return serialized;
}

export function decodeVolumeStrategyCheckpoint(
  serialized: string,
): Readonly<VolumeStrategyCheckpoint> | null {
  if (typeof serialized !== 'string'
      || Buffer.byteLength(serialized, 'utf8') > CHECKPOINT_MAX_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
  const rebuilt = normalizeCheckpointSnapshot(value);
  if (rebuilt === null || canonicalJson(rebuilt) !== serialized) return null;
  return rebuilt;
}

function sameCheckpointState(
  checkpoint: Readonly<VolumeStrategyCheckpoint>,
  candidate: Readonly<VolumeStrategyCheckpoint>,
): boolean {
  return sameCanonical(checkpoint.lastEvaluation, candidate.lastEvaluation)
    && sameCanonical(checkpoint.lastPlan, candidate.lastPlan)
    && sameCanonical(checkpoint.localReconciliation, candidate.localReconciliation);
}

function sameIdentity(
  checkpoint: Readonly<VolumeStrategyCheckpoint>,
  candidate: Readonly<VolumeStrategyCheckpoint>,
): boolean {
  return checkpoint.lastEvaluation.evaluationId === candidate.lastEvaluation.evaluationId
    || checkpoint.lastPlan.planId === candidate.lastPlan.planId;
}

function sameProposalRevision(
  checkpoint: Readonly<VolumeStrategyCheckpoint>,
  candidate: Readonly<VolumeStrategyCheckpoint>,
): boolean {
  return checkpoint.lastEvaluation.proposal.proposalId
      === candidate.lastEvaluation.proposal.proposalId
    && checkpoint.lastEvaluation.proposal.proposalRevision
      === candidate.lastEvaluation.proposal.proposalRevision;
}

function transitionRegresses(
  checkpoint: Readonly<VolumeStrategyCheckpoint>,
  candidate: Readonly<VolumeStrategyCheckpoint>,
): boolean {
  if (candidate.lastEvaluation.evaluatedAtMs < checkpoint.lastEvaluation.evaluatedAtMs) {
    return true;
  }
  return checkpoint.lastEvaluation.proposal.proposalId
      === candidate.lastEvaluation.proposal.proposalId
    && candidate.lastEvaluation.proposal.proposalRevision
      < checkpoint.lastEvaluation.proposal.proposalRevision;
}

function normalizeExpectedLoad(
  value: unknown,
): Readonly<Extract<
  VolumeStrategyCheckpointLoad,
  { status: 'EMPTY' | 'AVAILABLE' }
>> | null {
  const record = exactRecord(value, ['checkpoint', 'reasonCode', 'serialized', 'status']);
  if (record === null) return null;
  if (record.status === 'EMPTY') {
    if (record.checkpoint !== null
        || record.reasonCode !== null
        || record.serialized !== null) return null;
    return Object.freeze({
      status: 'EMPTY',
      serialized: null,
      checkpoint: null,
      reasonCode: null,
    });
  }
  if (record.status !== 'AVAILABLE'
      || record.reasonCode !== null
      || typeof record.serialized !== 'string') return null;
  const decoded = decodeVolumeStrategyCheckpoint(record.serialized);
  if (decoded === null || !sameCanonical(decoded, record.checkpoint)) return null;
  return Object.freeze({
    status: 'AVAILABLE',
    serialized: record.serialized,
    checkpoint: decoded,
    reasonCode: null,
  });
}

function eventInputs(
  checkpoint: Readonly<VolumeStrategyCheckpoint>,
): readonly [VolumeStrategyLedgerEventInput, VolumeStrategyLedgerEventInput] {
  const evaluation = checkpoint.lastEvaluation;
  const reconciliation = checkpoint.localReconciliation;
  const common = Object.freeze({
    severity: 'info',
    source: 'engine.volume.strategy-slice',
    strategy: 'volume_spike',
    correlation: evaluation.proposal.correlationId,
    createdAt: evaluation.evaluatedAtMs,
  });
  return Object.freeze([
    Object.freeze({
      ...common,
      kind: VOLUME_STRATEGY_EVALUATED_EVENT_KIND,
      symbol: evaluation.proposal.symbol,
      status: evaluation.disposition,
      reason: evaluation.rejectionCodes[0] ?? null,
      message: 'Volume strategy evaluation durably recorded without execution authority.',
      data: Object.freeze({
        schema: EVALUATED_EVENT_SCHEMA,
        checkpointRevision: checkpoint.revision,
        checkpointChecksum: checkpoint.checksum,
        evaluationId: evaluation.evaluationId,
        planId: checkpoint.lastPlan.planId,
        disposition: evaluation.disposition,
        rejectionCodes: Object.freeze([...evaluation.rejectionCodes]),
        executionAuthority: 'NONE',
        sendEligible: false,
        sends: 0,
        sideEffects: 0,
      }),
    }),
    Object.freeze({
      ...common,
      kind: VOLUME_STRATEGY_RECONCILED_EVENT_KIND,
      symbol: evaluation.proposal.symbol,
      status: reconciliation.status,
      reason: reconciliation.reasonCodes[0] ?? null,
      message: 'Volume strategy local Ledger reconciliation durably recorded.',
      data: Object.freeze({
        schema: RECONCILED_EVENT_SCHEMA,
        checkpointRevision: checkpoint.revision,
        checkpointChecksum: checkpoint.checksum,
        reconciliationId: reconciliation.reconciliationId,
        evaluationId: evaluation.evaluationId,
        planId: checkpoint.lastPlan.planId,
        status: reconciliation.status,
        executionAuthority: 'NONE',
        exchangeReconciliation: false,
        flatnessProven: false,
        sends: 0,
        sideEffects: 0,
      }),
    }),
  ]);
}

function normalizeLedgerEventSnapshot(value: unknown): Readonly<VolumeStrategyLedgerEventRecord> | null {
  const record = exactRecord(value, LEDGER_EVENT_KEYS);
  if (record === null
      || !Number.isSafeInteger(record.id)
      || Number(record.id) < 1
      || !Number.isSafeInteger(record.ts)
      || Number(record.ts) < 0
      || Object.is(record.ts, -0)
      || typeof record.kind !== 'string'
      || (record.symbol !== null && typeof record.symbol !== 'string')
      || (record.severity !== null && typeof record.severity !== 'string')
      || (record.source !== null && typeof record.source !== 'string')
      || (record.strategy !== null && typeof record.strategy !== 'string')
      || (record.status !== null && typeof record.status !== 'string')
      || (record.reason !== null && typeof record.reason !== 'string')
      || (record.message !== null && typeof record.message !== 'string')
      || (record.correlation !== null && typeof record.correlation !== 'string')
      || !Number.isSafeInteger(record.createdAt)
      || Number(record.createdAt) < 0
      || Object.is(record.createdAt, -0)) return null;
  return value as Readonly<VolumeStrategyLedgerEventRecord>;
}

function normalizeCasResult(value: unknown): VolumeStrategyLedgerCasResult | null {
  const snapshot = canonicalSnapshot<unknown>(value);
  if (snapshot === null) return null;
  const committed = exactRecord(snapshot, ['committed', 'events']);
  if (committed !== null && committed.committed === true && Array.isArray(committed.events)) {
    if (committed.events.length < 1 || committed.events.length > 8) return null;
    const events: Readonly<VolumeStrategyLedgerEventRecord>[] = [];
    for (const eventValue of committed.events) {
      const event = normalizeLedgerEventSnapshot(eventValue);
      if (event === null) return null;
      events.push(event);
    }
    return Object.freeze({
      committed: true,
      events: Object.freeze(events),
    });
  }
  const rejected = exactRecord(snapshot, ['committed', 'currentValue', 'reason']);
  if (rejected === null
      || rejected.committed !== false
      || (rejected.reason !== 'VERSION_CONFLICT'
        && rejected.reason !== 'DEADLINE_EXCEEDED')
      || (rejected.currentValue !== null && typeof rejected.currentValue !== 'string')) return null;
  return Object.freeze({
    committed: false,
    reason: rejected.reason,
    currentValue: rejected.currentValue as string | null,
  });
}

function eventReceiptExact(
  events: readonly VolumeStrategyLedgerEventRecord[],
  expected: readonly VolumeStrategyLedgerEventInput[],
): boolean {
  if (!Array.isArray(events)
      || events.length !== expected.length
      || events.length !== 2) return false;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const input = expected[index];
    if (!event
        || !Number.isSafeInteger(event.id)
        || event.id < 1
        || !Number.isSafeInteger(event.ts)
        || event.ts < 0
        || Object.is(event.ts, -0)
        || event.kind !== input.kind
        || event.symbol !== (input.symbol ?? null)
        || !sameCanonical(event.data, input.data ?? null)
        || event.severity !== (input.severity ?? null)
        || event.source !== (input.source ?? null)
        || event.strategy !== (input.strategy ?? null)
        || event.status !== (input.status ?? null)
        || event.reason !== (input.reason ?? null)
        || event.message !== (input.message ?? null)
        || event.correlation !== (input.correlation ?? null)
        || event.createdAt !== (input.createdAt ?? event.ts)) return false;
  }
  return events[1].id > events[0].id && events[1].ts === events[0].ts;
}

function unavailableLoad(): VolumeStrategyCheckpointLoad {
  return Object.freeze({
    status: 'UNAVAILABLE',
    serialized: null,
    checkpoint: null,
    reasonCode: 'VOLUME_STRATEGY_LEDGER_UNAVAILABLE',
  });
}

function failedCommit(
  disposition: Extract<
    VolumeStrategyCheckpointCommit,
    { checkpoint: null }
  >['disposition'],
  reasonCode: string,
  current: VolumeStrategyCheckpointLoad,
): VolumeStrategyCheckpointCommit {
  return Object.freeze({
    disposition,
    checkpoint: null,
    eventIds: Object.freeze([]) as readonly [],
    reasonCode,
    current,
  });
}

export class VolumeStrategyLedgerAdapter {
  constructor(private readonly ledger: Readonly<VolumeStrategyLedgerPort>) {
    if (!ledger
        || typeof ledger.getConfigValue !== 'function'
        || typeof ledger.compareAndSetConfigValueAndLogEvents !== 'function') {
      throw new TypeError('Volume strategy persistence requires the canonical Ledger CAS owner');
    }
  }

  load(): VolumeStrategyCheckpointLoad {
    let serialized: string | null;
    try {
      serialized = this.ledger.getConfigValue(VOLUME_STRATEGY_CONFIG_KEY);
    } catch {
      return unavailableLoad();
    }
    if (serialized === null) {
      return Object.freeze({
        status: 'EMPTY',
        serialized: null,
        checkpoint: null,
        reasonCode: null,
      });
    }
    if (typeof serialized !== 'string') return unavailableLoad();
    const checkpoint = decodeVolumeStrategyCheckpoint(serialized);
    if (checkpoint === null) {
      return Object.freeze({
        status: 'CORRUPT',
        serialized,
        checkpoint: null,
        reasonCode: 'VOLUME_STRATEGY_LEDGER_CORRUPT',
      });
    }
    return Object.freeze({
      status: 'AVAILABLE',
      serialized,
      checkpoint,
      reasonCode: null,
    });
  }

  commit(input: Readonly<VolumeStrategyCheckpointCommitInput>): VolumeStrategyCheckpointCommit {
    const fallback = unavailableLoad();
    const root = exactRecord(input, ['evaluation', 'expected'])
      ?? exactRecord(input, ['commitBeforeMs', 'evaluation', 'expected']);
    const expected = root === null ? null : normalizeExpectedLoad(root.expected);
    const commitBeforeMs = root?.commitBeforeMs as number | undefined;
    const evaluationValue = root?.evaluation;
    if (expected === null || !validCommitDeadline(commitBeforeMs)) {
      return failedCommit(
        'INVALID_REQUEST',
        'VOLUME_STRATEGY_LEDGER_COMMIT_INVALID',
        fallback,
      );
    }
    const evaluation = normalizeEvaluation(evaluationValue);
    if (evaluation === null) {
      return failedCommit(
        'INVALID_REQUEST',
        'VOLUME_STRATEGY_EVALUATION_INVALID',
        expected,
      );
    }
    const priorRevision = expected.status === 'AVAILABLE'
      ? expected.checkpoint.revision
      : 0;
    if (priorRevision >= Number.MAX_SAFE_INTEGER) {
      return failedCommit(
        'VERSION_CONFLICT',
        'VOLUME_STRATEGY_LEDGER_REVISION_EXHAUSTED',
        expected,
      );
    }
    const candidate = createCheckpoint(priorRevision + 1, evaluation);
    if (candidate === null) {
      return failedCommit(
        'INVALID_REQUEST',
        'VOLUME_STRATEGY_CHECKPOINT_INVALID',
        expected,
      );
    }
    if (expected.status === 'AVAILABLE') {
      if (sameCheckpointState(expected.checkpoint, candidate)) {
        return Object.freeze({
          disposition: 'ALREADY_COMMITTED',
          checkpoint: expected.checkpoint,
          eventIds: Object.freeze([]),
          reasonCode: null,
        });
      }
      if (sameIdentity(expected.checkpoint, candidate)
          || sameProposalRevision(expected.checkpoint, candidate)) {
        return failedCommit(
          'IDENTITY_CONFLICT',
          'VOLUME_STRATEGY_LEDGER_IDENTITY_CONFLICT',
          expected,
        );
      }
      if (transitionRegresses(expected.checkpoint, candidate)) {
        return failedCommit(
          'VERSION_CONFLICT',
          'VOLUME_STRATEGY_LEDGER_TRANSITION_REGRESSION',
          expected,
        );
      }
    }

    let serialized: string;
    try {
      serialized = encodeVolumeStrategyCheckpoint(candidate);
    } catch {
      return failedCommit(
        'INVALID_REQUEST',
        'VOLUME_STRATEGY_CHECKPOINT_INVALID',
        expected,
      );
    }
    const records = eventInputs(candidate);
    let providerResult: unknown;
    try {
      providerResult = this.ledger.compareAndSetConfigValueAndLogEvents(
        VOLUME_STRATEGY_CONFIG_KEY,
        expected.serialized,
        serialized,
        records,
        commitBeforeMs,
      );
    } catch {
      const readback = this.load();
      if (readback.status === 'AVAILABLE'
          && readback.serialized === serialized
          && sameCheckpointState(readback.checkpoint, candidate)) {
        return Object.freeze({
          disposition: 'ALREADY_COMMITTED',
          checkpoint: readback.checkpoint,
          eventIds: Object.freeze([]),
          reasonCode: null,
        });
      }
      return failedCommit(
        readback.status === 'CORRUPT' ? 'PERSISTENCE_CORRUPT' : 'PERSISTENCE_UNAVAILABLE',
        readback.status === 'CORRUPT'
          ? 'VOLUME_STRATEGY_LEDGER_CORRUPT'
          : 'VOLUME_STRATEGY_LEDGER_COMMIT_FAILED',
        readback,
      );
    }
    const result = normalizeCasResult(providerResult);
    if (result === null) {
      return failedCommit(
        'COMMIT_READBACK_INVALID',
        'VOLUME_STRATEGY_LEDGER_EVENT_READBACK_INVALID',
        this.load(),
      );
    }

    if (result.committed) {
      if (!eventReceiptExact(result.events, records)) {
        return failedCommit(
          'COMMIT_READBACK_INVALID',
          'VOLUME_STRATEGY_LEDGER_EVENT_READBACK_INVALID',
          this.load(),
        );
      }
      const readback = this.load();
      if (readback.status !== 'AVAILABLE'
          || readback.serialized !== serialized
          || readback.checkpoint.checksum !== candidate.checksum
          || !sameCheckpointState(readback.checkpoint, candidate)) {
        return failedCommit(
          'COMMIT_READBACK_INVALID',
          'VOLUME_STRATEGY_LEDGER_CHECKPOINT_READBACK_INVALID',
          readback,
        );
      }
      return Object.freeze({
        disposition: 'COMMITTED_NEW',
        checkpoint: readback.checkpoint,
        eventIds: Object.freeze(result.events.map((event) => event.id)),
        reasonCode: null,
      });
    }

    const winner = this.load();
    if (winner.status === 'AVAILABLE'
        && winner.serialized === serialized
        && sameCheckpointState(winner.checkpoint, candidate)) {
      return Object.freeze({
        disposition: 'ALREADY_COMMITTED',
        checkpoint: winner.checkpoint,
        eventIds: Object.freeze([]),
        reasonCode: null,
      });
    }
    if (winner.status === 'CORRUPT') {
      return failedCommit(
        'PERSISTENCE_CORRUPT',
        'VOLUME_STRATEGY_LEDGER_CORRUPT',
        winner,
      );
    }
    if (winner.status === 'UNAVAILABLE') {
      return failedCommit(
        'PERSISTENCE_UNAVAILABLE',
        'VOLUME_STRATEGY_LEDGER_UNAVAILABLE',
        winner,
      );
    }
    if (winner.status === 'AVAILABLE'
        && (sameIdentity(winner.checkpoint, candidate)
          || sameProposalRevision(winner.checkpoint, candidate))) {
      return failedCommit(
        'IDENTITY_CONFLICT',
        'VOLUME_STRATEGY_LEDGER_IDENTITY_CONFLICT',
        winner,
      );
    }
    if (winner.status === 'AVAILABLE' && transitionRegresses(winner.checkpoint, candidate)) {
      return failedCommit(
        'VERSION_CONFLICT',
        'VOLUME_STRATEGY_LEDGER_TRANSITION_REGRESSION',
        winner,
      );
    }
    return failedCommit(
      result.reason,
      result.reason === 'VERSION_CONFLICT'
        ? 'VOLUME_STRATEGY_LEDGER_VERSION_CONFLICT'
        : 'VOLUME_STRATEGY_LEDGER_DEADLINE_EXCEEDED',
      winner,
    );
  }
}

/**
 * Durability-first owner. A candidate is exposed only after an exact durable
 * checkpoint and both atomic event receipts have been verified. Any Ledger
 * ambiguity clears the published checkpoint and blocks this slice locally.
 */
export class VolumeStrategyLedgerCoordinator {
  private published: VolumeStrategyLedgerCoordinatorSnapshot = Object.freeze({
    status: 'EMPTY',
    checkpoint: null,
    reasonCode: null,
  });

  constructor(private readonly persistence: Readonly<VolumeStrategyLedgerAdapter>) {}

  restore(): VolumeStrategyLedgerRestoreResult {
    const current = this.persistence.load();
    if (current.status === 'EMPTY') {
      this.published = Object.freeze({
        status: 'EMPTY',
        checkpoint: null,
        reasonCode: null,
      });
      return Object.freeze({
        status: 'EMPTY',
        checkpoint: null,
        reasonCode: null,
      });
    }
    if (current.status === 'AVAILABLE') {
      this.published = Object.freeze({
        status: 'AVAILABLE',
        checkpoint: current.checkpoint,
        reasonCode: null,
      });
      return Object.freeze({
        status: 'RESTORED',
        checkpoint: current.checkpoint,
        reasonCode: null,
      });
    }
    this.published = Object.freeze({
      status: 'BLOCKED',
      checkpoint: null,
      reasonCode: current.reasonCode,
    });
    return Object.freeze({
      status: current.status,
      checkpoint: null,
      reasonCode: current.reasonCode,
    });
  }

  commit(input: Readonly<{
    readonly evaluation: Readonly<VolumeStrategyEvaluation>;
    readonly commitBeforeMs?: number;
  }>): VolumeStrategyCheckpointCommit {
    const expected = this.persistence.load();
    if (expected.status === 'CORRUPT' || expected.status === 'UNAVAILABLE') {
      this.published = Object.freeze({
        status: 'BLOCKED',
        checkpoint: null,
        reasonCode: expected.reasonCode,
      });
      return failedCommit(
        expected.status === 'CORRUPT' ? 'PERSISTENCE_CORRUPT' : 'PERSISTENCE_UNAVAILABLE',
        expected.reasonCode,
        expected,
      );
    }
    const root = exactRecord(input, ['evaluation'])
      ?? exactRecord(input, ['commitBeforeMs', 'evaluation']);
    if (root === null) {
      const result = failedCommit(
        'INVALID_REQUEST',
        'VOLUME_STRATEGY_LEDGER_COMMIT_INVALID',
        expected,
      );
      this.published = Object.freeze({
        status: 'BLOCKED',
        checkpoint: null,
        reasonCode: result.reasonCode ?? 'VOLUME_STRATEGY_LEDGER_COMMIT_INVALID',
      });
      return result;
    }
    const result = this.persistence.commit({
      expected,
      evaluation: root.evaluation as Readonly<VolumeStrategyEvaluation>,
      commitBeforeMs: root.commitBeforeMs as number | undefined,
    });
    if (result.disposition === 'COMMITTED_NEW'
        || result.disposition === 'ALREADY_COMMITTED') {
      this.published = Object.freeze({
        status: 'AVAILABLE',
        checkpoint: result.checkpoint,
        reasonCode: null,
      });
      return result;
    }
    this.published = Object.freeze({
      status: 'BLOCKED',
      checkpoint: null,
      reasonCode: result.reasonCode ?? 'VOLUME_STRATEGY_LEDGER_COMMIT_FAILED',
    });
    return result;
  }

  snapshot(): VolumeStrategyLedgerCoordinatorSnapshot {
    return this.published;
  }
}

export function createVolumeStrategyLedgerCoordinator(
  ledger: Readonly<VolumeStrategyLedgerPort>,
): VolumeStrategyLedgerCoordinator {
  return new VolumeStrategyLedgerCoordinator(new VolumeStrategyLedgerAdapter(ledger));
}
