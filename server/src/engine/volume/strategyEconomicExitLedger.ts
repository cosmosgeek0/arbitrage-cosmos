import { types as utilTypes } from 'node:util';
import {
  canonicalJson,
  stableHash128Hex,
} from '../../foundation/contracts/index.js';
import {
  validateVolumeEconomicExitDecision,
  validateVolumeForwardExitSample,
  type VolumeEconomicExitDecision,
  type VolumeForwardExitSample,
} from './strategyEconomicExit.js';
import type {
  VolumeStrategyLedgerCasResult,
  VolumeStrategyLedgerEventInput,
  VolumeStrategyLedgerEventRecord,
  VolumeStrategyLedgerPort,
} from './strategyLedger.js';

export const VOLUME_ECONOMIC_EXIT_CONFIG_KEY =
  'volume.strategy-economic-exit-shadow.v1' as const;
export const VOLUME_ECONOMIC_EXIT_SAMPLED_EVENT_KIND =
  'volume.strategy.exit-shadow.sampled' as const;
export const VOLUME_ECONOMIC_EXIT_RECONCILED_EVENT_KIND =
  'volume.strategy.exit-shadow.reconciled' as const;

const CHECKPOINT_SCHEMA =
  'cosmos.engine.volume.strategy-economic-exit-shadow.checkpoint.v1' as const;
const CHECKPOINT_SCHEMA_VERSION = 1 as const;
const SAMPLED_EVENT_SCHEMA =
  'cosmos.engine.volume.strategy-economic-exit-shadow.sampled.v1' as const;
const RECONCILED_EVENT_SCHEMA =
  'cosmos.engine.volume.strategy-economic-exit-shadow.reconciled.v1' as const;
const CHECKPOINT_MAX_BYTES = 64 * 1024;
const CHECKPOINT_KEYS = Object.freeze([
  'checksum',
  'latestDecision',
  'latestSample',
  'localReconciliation',
  'revision',
  'schema',
  'schemaVersion',
]);
const RECONCILIATION_KEYS = Object.freeze([
  'actualFillReconciliation',
  'evaluatedAtMs',
  'exchangeReconciliation',
  'executionAuthority',
  'expectedDecisionId',
  'expectedSampleId',
  'flatnessProven',
  'persistedDecisionId',
  'persistedSampleId',
  'positionReconciliation',
  'reasonCodes',
  'reconciliationId',
  'schemaVersion',
  'scope',
  'status',
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
const STATE_KEYS = Object.freeze(['decision', 'sample']);

export type VolumeEconomicExitLocalReconciliationStatus =
  | 'EXACT'
  | 'STALE'
  | 'UNAVAILABLE'
  | 'AMBIGUOUS'
  | 'DIVERGED';

export interface VolumeEconomicExitLocalReconciliation {
  readonly schemaVersion: 1;
  readonly reconciliationId: string;
  readonly scope: 'LOCAL_LEDGER_ONLY';
  readonly status: VolumeEconomicExitLocalReconciliationStatus;
  readonly evaluatedAtMs: number | null;
  readonly expectedSampleId: string | null;
  readonly expectedDecisionId: string | null;
  readonly persistedSampleId: string | null;
  readonly persistedDecisionId: string | null;
  readonly reasonCodes: readonly string[];
  readonly executionAuthority: 'NONE';
  readonly exchangeReconciliation: false;
  readonly positionReconciliation: false;
  readonly actualFillReconciliation: false;
  readonly flatnessProven: false;
}

export interface VolumeEconomicExitCheckpoint {
  readonly schema: typeof CHECKPOINT_SCHEMA;
  readonly schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  readonly revision: number;
  readonly checksum: string;
  readonly latestSample: Readonly<VolumeForwardExitSample>;
  readonly latestDecision: Readonly<VolumeEconomicExitDecision>;
  readonly localReconciliation: Readonly<VolumeEconomicExitLocalReconciliation>;
}

interface VolumeEconomicExitState {
  readonly sample: Readonly<VolumeForwardExitSample>;
  readonly decision: Readonly<VolumeEconomicExitDecision>;
}

export type VolumeEconomicExitCheckpointLoad = Readonly<
  | {
      status: 'EMPTY';
      serialized: null;
      checkpoint: null;
      reasonCode: null;
    }
  | {
      status: 'AVAILABLE';
      serialized: string;
      checkpoint: Readonly<VolumeEconomicExitCheckpoint>;
      reasonCode: null;
    }
  | {
      status: 'CORRUPT';
      serialized: string;
      checkpoint: null;
      reasonCode: 'VOLUME_EXIT_SHADOW_LEDGER_CORRUPT';
    }
  | {
      status: 'UNAVAILABLE';
      serialized: null;
      checkpoint: null;
      reasonCode: 'VOLUME_EXIT_SHADOW_LEDGER_UNAVAILABLE';
    }
>;

export type VolumeEconomicExitCheckpointCommit = Readonly<
  | {
      disposition: 'COMMITTED_NEW' | 'ALREADY_COMMITTED';
      checkpoint: Readonly<VolumeEconomicExitCheckpoint>;
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
      current: VolumeEconomicExitCheckpointLoad;
    }
>;

export interface VolumeEconomicExitCheckpointCommitInput {
  readonly expected: Readonly<Extract<
    VolumeEconomicExitCheckpointLoad,
    { status: 'EMPTY' | 'AVAILABLE' }
  >>;
  readonly sample: Readonly<VolumeForwardExitSample>;
  readonly decision: Readonly<VolumeEconomicExitDecision>;
  readonly commitBeforeMs?: number;
}

export type VolumeEconomicExitLedgerRestoreResult = Readonly<
  | {
      status: 'EMPTY';
      checkpoint: null;
      reasonCode: null;
    }
  | {
      status: 'RESTORED';
      checkpoint: Readonly<VolumeEconomicExitCheckpoint>;
      reasonCode: null;
    }
  | {
      status: 'CORRUPT' | 'UNAVAILABLE';
      checkpoint: null;
      reasonCode: string;
    }
>;

export type VolumeEconomicExitLedgerCoordinatorSnapshot = Readonly<
  | {
      status: 'EMPTY';
      checkpoint: null;
      reasonCode: null;
    }
  | {
      status: 'AVAILABLE';
      checkpoint: Readonly<VolumeEconomicExitCheckpoint>;
      reasonCode: null;
    }
  | {
      status: 'BLOCKED';
      checkpoint: null;
      reasonCode: string;
    }
>;

interface SnapshotState {
  nodes: number;
  readonly seen: WeakSet<object>;
}

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

function snapshotValue(value: unknown, state: SnapshotState, depth = 0): unknown {
  state.nodes += 1;
  if (state.nodes > 8_192 || depth > 32) throw new TypeError('exit state exceeds its bound');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > CHECKPOINT_MAX_BYTES) throw new TypeError('exit string exceeds its bound');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError('invalid exit number');
    return value;
  }
  if (typeof value !== 'object' || utilTypes.isProxy(value)) {
    throw new TypeError('ordinary exit data required');
  }
  if (state.seen.has(value)) throw new TypeError('cyclic exit data is unsupported');
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('ordinary array required');
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 256) {
        throw new TypeError('exit array exceeds its bound');
      }
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== length + 1 || ownKeys.some((key) => typeof key === 'symbol')) {
        throw new TypeError('dense exit array required');
      }
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
          throw new TypeError('exit array accessors are unsupported');
        }
        result.push(snapshotValue(descriptor.value, state, depth + 1));
      }
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('ordinary exit record required');
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length > 256 || ownKeys.some((key) => typeof key !== 'string')) {
      throw new TypeError('exit record exceeds its bound');
    }
    const result: Record<string, unknown> = {};
    for (const key of (ownKeys as string[]).sort(compareText)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new TypeError('unsafe exit key');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        throw new TypeError('exit record accessors are unsupported');
      }
      result[key] = snapshotValue(descriptor.value, state, depth + 1);
    }
    return result;
  } finally {
    state.seen.delete(value);
  }
}

function canonicalSnapshot<T>(value: unknown): Readonly<T> | null {
  try {
    const serialized = canonicalJson(snapshotValue(value, {
      nodes: 0,
      seen: new WeakSet<object>(),
    }));
    return deepFreeze(JSON.parse(serialized) as T);
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

function safeCanonical(value: unknown): string | null {
  const snapshot = canonicalSnapshot<unknown>(value);
  if (snapshot === null) return null;
  try {
    return canonicalJson(snapshot);
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

function validUtcMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 4_102_444_800_000
    && !Object.is(value, -0);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function validCommitDeadline(value: unknown): value is number | undefined {
  return value === undefined
    || (typeof value === 'number'
      && Number.isSafeInteger(value)
      && value >= 0
      && !Object.is(value, -0));
}

function normalizeSample(value: unknown): Readonly<VolumeForwardExitSample> | null {
  const snapshot = canonicalSnapshot<VolumeForwardExitSample>(value);
  return snapshot !== null && validateVolumeForwardExitSample(snapshot) ? snapshot : null;
}

function normalizeDecision(value: unknown): Readonly<VolumeEconomicExitDecision> | null {
  const snapshot = canonicalSnapshot<VolumeEconomicExitDecision>(value);
  return snapshot !== null && validateVolumeEconomicExitDecision(snapshot) ? snapshot : null;
}

function normalizeState(value: unknown): Readonly<VolumeEconomicExitState> | null {
  const record = exactRecord(value, STATE_KEYS);
  if (record === null) return null;
  const sample = normalizeSample(record.sample);
  const decision = normalizeDecision(record.decision);
  if (sample === null || decision === null || decision.sampleId !== sample.sampleId) return null;
  return Object.freeze({ sample, decision });
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

function reconciliationSemantic(
  value: Omit<VolumeEconomicExitLocalReconciliation, 'reconciliationId'>,
): Omit<VolumeEconomicExitLocalReconciliation, 'reconciliationId'> {
  return value;
}

export function reconcileVolumeEconomicExitLocal(
  expectedValue: unknown,
  persistedValue: unknown,
): Readonly<VolumeEconomicExitLocalReconciliation> {
  const expected = normalizeState(expectedValue);
  const persisted = normalizeState(persistedValue);
  let status: VolumeEconomicExitLocalReconciliationStatus;
  let reasons: readonly string[];
  if (expectedValue === null || persistedValue === null) {
    status = 'UNAVAILABLE';
    reasons = Object.freeze([
      expectedValue === null
        ? 'EXPECTED_EXIT_STATE_UNAVAILABLE'
        : 'PERSISTED_EXIT_STATE_UNAVAILABLE',
    ]);
  } else if (expected === null || persisted === null) {
    status = 'AMBIGUOUS';
    reasons = Object.freeze(['VOLUME_EXIT_STATE_INVALID_AMBIGUOUS']);
  } else if (expected.sample.sampleId === persisted.sample.sampleId
      && expected.decision.decisionId === persisted.decision.decisionId) {
    status = 'EXACT';
    reasons = Object.freeze([]);
  } else if (expected.sample.entryEvaluationId === persisted.sample.entryEvaluationId
      && expected.sample.policyDigest === persisted.sample.policyDigest
      && (persisted.sample.sampleRevision < expected.sample.sampleRevision
        || (persisted.sample.sampleRevision === expected.sample.sampleRevision
          && persisted.decision.evaluatedAtMs < expected.decision.evaluatedAtMs))) {
    status = 'STALE';
    reasons = Object.freeze(['PERSISTED_EXIT_STATE_STALE']);
  } else {
    status = 'DIVERGED';
    reasons = Object.freeze(['PERSISTED_EXIT_STATE_DIVERGED']);
  }

  const withoutId = Object.freeze({
    schemaVersion: 1 as const,
    scope: 'LOCAL_LEDGER_ONLY' as const,
    status,
    evaluatedAtMs: expected?.decision.evaluatedAtMs
      ?? persisted?.decision.evaluatedAtMs
      ?? null,
    expectedSampleId: expected?.sample.sampleId ?? null,
    expectedDecisionId: expected?.decision.decisionId ?? null,
    persistedSampleId: persisted?.sample.sampleId ?? null,
    persistedDecisionId: persisted?.decision.decisionId ?? null,
    reasonCodes: reasons,
    executionAuthority: 'NONE' as const,
    exchangeReconciliation: false as const,
    positionReconciliation: false as const,
    actualFillReconciliation: false as const,
    flatnessProven: false as const,
  });
  return deepFreeze({
    reconciliationId:
      `ver_${stableHash128Hex(
        `volume.strategy.exit-shadow.local-reconciliation.v1|${canonicalJson(withoutId)}`,
      )}`,
    ...withoutId,
  });
}

export function validateVolumeEconomicExitLocalReconciliation(
  value: unknown,
): value is Readonly<VolumeEconomicExitLocalReconciliation> {
  const snapshot = canonicalSnapshot<Record<string, unknown>>(value);
  const record = snapshot === null ? null : exactRecord(snapshot, RECONCILIATION_KEYS);
  if (record === null
      || record.schemaVersion !== 1
      || !validIdentifier(record.reconciliationId)
      || record.scope !== 'LOCAL_LEDGER_ONLY'
      || !['EXACT', 'STALE', 'UNAVAILABLE', 'AMBIGUOUS', 'DIVERGED'].includes(
        record.status as string,
      )
      || (record.evaluatedAtMs !== null && !validUtcMs(record.evaluatedAtMs))
      || (record.expectedSampleId !== null && !validIdentifier(record.expectedSampleId))
      || (record.expectedDecisionId !== null && !validIdentifier(record.expectedDecisionId))
      || (record.persistedSampleId !== null && !validIdentifier(record.persistedSampleId))
      || (record.persistedDecisionId !== null && !validIdentifier(record.persistedDecisionId))
      || !Array.isArray(record.reasonCodes)
      || record.reasonCodes.length > 16
      || record.reasonCodes.some((reason) => !validIdentifier(reason))
      || canonicalJson(sortedUnique(record.reasonCodes as string[])) !== canonicalJson(record.reasonCodes)
      || record.executionAuthority !== 'NONE'
      || record.exchangeReconciliation !== false
      || record.positionReconciliation !== false
      || record.actualFillReconciliation !== false
      || record.flatnessProven !== false) return false;
  const status = record.status as VolumeEconomicExitLocalReconciliationStatus;
  const expectedPresent = record.expectedSampleId !== null && record.expectedDecisionId !== null;
  const expectedAbsent = record.expectedSampleId === null && record.expectedDecisionId === null;
  const persistedPresent = record.persistedSampleId !== null && record.persistedDecisionId !== null;
  const persistedAbsent = record.persistedSampleId === null && record.persistedDecisionId === null;
  if ((!expectedPresent && !expectedAbsent) || (!persistedPresent && !persistedAbsent)) return false;
  const reasons = record.reasonCodes as string[];
  if (status === 'EXACT') {
    if (!expectedPresent
        || !persistedPresent
        || record.evaluatedAtMs === null
        || record.expectedSampleId !== record.persistedSampleId
        || record.expectedDecisionId !== record.persistedDecisionId
        || reasons.length !== 0) return false;
  } else if (status === 'STALE') {
    if (!expectedPresent
        || !persistedPresent
        || record.evaluatedAtMs === null
        || (record.expectedSampleId === record.persistedSampleId
          && record.expectedDecisionId === record.persistedDecisionId)
        || reasons.length !== 1
        || reasons[0] !== 'PERSISTED_EXIT_STATE_STALE') return false;
  } else if (status === 'DIVERGED') {
    if (!expectedPresent
        || !persistedPresent
        || record.evaluatedAtMs === null
        || (record.expectedSampleId === record.persistedSampleId
          && record.expectedDecisionId === record.persistedDecisionId)
        || reasons.length !== 1
        || reasons[0] !== 'PERSISTED_EXIT_STATE_DIVERGED') return false;
  } else if (status === 'UNAVAILABLE') {
    if ((!expectedAbsent && !persistedAbsent)
        || reasons.length !== 1
        || (expectedAbsent && reasons[0] !== 'EXPECTED_EXIT_STATE_UNAVAILABLE')
        || (expectedPresent
          && persistedAbsent
          && reasons[0] !== 'PERSISTED_EXIT_STATE_UNAVAILABLE')) return false;
    if ((expectedPresent || persistedPresent) && record.evaluatedAtMs === null) return false;
    if (expectedAbsent && persistedAbsent && record.evaluatedAtMs !== null) return false;
  } else if (reasons.length === 0) {
    return false;
  }
  const {
    reconciliationId,
    ...semantic
  } = record as unknown as VolumeEconomicExitLocalReconciliation;
  return reconciliationId
    === `ver_${stableHash128Hex(
      `volume.strategy.exit-shadow.local-reconciliation.v1|${canonicalJson(
        reconciliationSemantic(semantic),
      )}`,
    )}`;
}

function normalizeReconciliation(
  value: unknown,
): Readonly<VolumeEconomicExitLocalReconciliation> | null {
  const snapshot = canonicalSnapshot<VolumeEconomicExitLocalReconciliation>(value);
  return snapshot !== null && validateVolumeEconomicExitLocalReconciliation(snapshot)
    ? snapshot
    : null;
}

function checkpointPayload(
  revision: number,
  state: Readonly<VolumeEconomicExitState>,
  reconciliation: Readonly<VolumeEconomicExitLocalReconciliation>,
): Omit<VolumeEconomicExitCheckpoint, 'checksum'> {
  return Object.freeze({
    schema: CHECKPOINT_SCHEMA,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    revision,
    latestSample: state.sample,
    latestDecision: state.decision,
    localReconciliation: reconciliation,
  });
}

function createCheckpoint(
  revision: number,
  sampleValue: unknown,
  decisionValue: unknown,
): Readonly<VolumeEconomicExitCheckpoint> | null {
  if (!validRevision(revision)) return null;
  const state = normalizeState({ sample: sampleValue, decision: decisionValue });
  if (state === null) return null;
  const reconciliation = normalizeReconciliation(
    reconcileVolumeEconomicExitLocal(state, state),
  );
  if (reconciliation === null
      || reconciliation.status !== 'EXACT'
      || reconciliation.expectedSampleId !== state.sample.sampleId
      || reconciliation.persistedSampleId !== state.sample.sampleId
      || reconciliation.expectedDecisionId !== state.decision.decisionId
      || reconciliation.persistedDecisionId !== state.decision.decisionId) return null;
  const payload = checkpointPayload(revision, state, reconciliation);
  return deepFreeze({
    ...payload,
    checksum:
      `vec_${stableHash128Hex(
        `volume.strategy.exit-shadow.checkpoint.v1|${canonicalJson(payload)}`,
      )}`,
  });
}

function normalizeCheckpoint(value: unknown): Readonly<VolumeEconomicExitCheckpoint> | null {
  const record = exactRecord(value, CHECKPOINT_KEYS);
  if (record === null
      || record.schema !== CHECKPOINT_SCHEMA
      || record.schemaVersion !== CHECKPOINT_SCHEMA_VERSION
      || !validRevision(record.revision)
      || typeof record.checksum !== 'string'
      || !/^vec_[a-f0-9]{32}$/.test(record.checksum)) return null;
  const rebuilt = createCheckpoint(
    record.revision as number,
    record.latestSample,
    record.latestDecision,
  );
  if (rebuilt === null
      || rebuilt.checksum !== record.checksum
      || !sameCanonical(rebuilt, value)) return null;
  return rebuilt;
}

export function encodeVolumeEconomicExitCheckpoint(
  checkpoint: Readonly<VolumeEconomicExitCheckpoint>,
): string {
  const snapshot = canonicalSnapshot<VolumeEconomicExitCheckpoint>(checkpoint);
  const rebuilt = snapshot === null ? null : normalizeCheckpoint(snapshot);
  if (rebuilt === null) throw new TypeError('Volume exit checkpoint is invalid or diverged');
  const serialized = canonicalJson(rebuilt);
  if (Buffer.byteLength(serialized, 'utf8') > CHECKPOINT_MAX_BYTES) {
    throw new RangeError('Volume exit checkpoint exceeds its bounded envelope');
  }
  return serialized;
}

export function decodeVolumeEconomicExitCheckpoint(
  serialized: string,
): Readonly<VolumeEconomicExitCheckpoint> | null {
  if (typeof serialized !== 'string'
      || Buffer.byteLength(serialized, 'utf8') > CHECKPOINT_MAX_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
  const checkpoint = normalizeCheckpoint(parsed);
  return checkpoint !== null && canonicalJson(checkpoint) === serialized ? checkpoint : null;
}

function checkpointState(
  checkpoint: Readonly<VolumeEconomicExitCheckpoint>,
): Readonly<VolumeEconomicExitState> {
  return Object.freeze({
    sample: checkpoint.latestSample,
    decision: checkpoint.latestDecision,
  });
}

function sameCheckpointState(
  left: Readonly<VolumeEconomicExitCheckpoint>,
  right: Readonly<VolumeEconomicExitCheckpoint>,
): boolean {
  return sameCanonical(left.latestSample, right.latestSample)
    && sameCanonical(left.latestDecision, right.latestDecision)
    && sameCanonical(left.localReconciliation, right.localReconciliation);
}

function sameIdentity(
  left: Readonly<VolumeEconomicExitCheckpoint>,
  right: Readonly<VolumeEconomicExitCheckpoint>,
): boolean {
  return left.latestSample.sampleId === right.latestSample.sampleId
    || left.latestDecision.decisionId === right.latestDecision.decisionId
    || (left.latestSample.entryEvaluationId === right.latestSample.entryEvaluationId
      && left.latestSample.policyDigest === right.latestSample.policyDigest
      && left.latestSample.sampleRevision === right.latestSample.sampleRevision);
}

function sameChain(
  left: Readonly<VolumeEconomicExitCheckpoint>,
  right: Readonly<VolumeEconomicExitCheckpoint>,
): boolean {
  return left.latestSample.entryEvaluationId === right.latestSample.entryEvaluationId
    && left.latestSample.entryPlanId === right.latestSample.entryPlanId
    && left.latestSample.entryProposalId === right.latestSample.entryProposalId
    && left.latestSample.entryProposalDigest === right.latestSample.entryProposalDigest
    && left.latestSample.entryObservationDigest === right.latestSample.entryObservationDigest
    && left.latestSample.policyDigest === right.latestSample.policyDigest
    && left.latestSample.symbol === right.latestSample.symbol
    && left.latestSample.direction === right.latestSample.direction
    && left.latestSample.openedAtMs === right.latestSample.openedAtMs;
}

function transitionReason(
  current: Readonly<VolumeEconomicExitCheckpoint>,
  candidate: Readonly<VolumeEconomicExitCheckpoint>,
): string | null {
  const currentSample = current.latestSample;
  const candidateSample = candidate.latestSample;
  const currentDecision = current.latestDecision;
  if (candidate.latestDecision.evaluatedAtMs < currentDecision.evaluatedAtMs
      || (sameChain(current, candidate)
        && candidateSample.sampleRevision <= currentSample.sampleRevision)) {
    return 'VOLUME_EXIT_SHADOW_LEDGER_TRANSITION_REGRESSION';
  }
  if (currentDecision.lifecyclePhase === 'HOLDING') {
    if (!sameChain(current, candidate)) {
      return 'VOLUME_EXIT_SHADOW_LEDGER_ACTIVE_HOLD_CONFLICT';
    }
    if (candidateSample.sampleRevision !== currentSample.sampleRevision + 1
        || candidateSample.previousSampleId !== currentSample.sampleId) {
      return 'VOLUME_EXIT_SHADOW_LEDGER_TRANSITION_INVALID';
    }
    return null;
  }
  if (sameChain(current, candidate)) {
    return 'VOLUME_EXIT_SHADOW_LEDGER_TERMINAL_SUCCESSOR_FORBIDDEN';
  }
  if (candidateSample.sampleRevision !== 1 || candidateSample.previousSampleId !== null) {
    return 'VOLUME_EXIT_SHADOW_LEDGER_TRANSITION_INVALID';
  }
  return null;
}

function normalizeExpectedLoad(
  value: unknown,
): Readonly<Extract<
  VolumeEconomicExitCheckpointLoad,
  { status: 'EMPTY' | 'AVAILABLE' }
>> | null {
  const record = exactRecord(value, ['checkpoint', 'reasonCode', 'serialized', 'status']);
  if (record === null) return null;
  if (record.status === 'EMPTY') {
    if (record.checkpoint !== null || record.reasonCode !== null || record.serialized !== null) {
      return null;
    }
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
  const checkpoint = decodeVolumeEconomicExitCheckpoint(record.serialized);
  if (checkpoint === null || !sameCanonical(checkpoint, record.checkpoint)) return null;
  return Object.freeze({
    status: 'AVAILABLE',
    serialized: record.serialized,
    checkpoint,
    reasonCode: null,
  });
}

function eventInputs(
  checkpoint: Readonly<VolumeEconomicExitCheckpoint>,
): readonly [VolumeStrategyLedgerEventInput, VolumeStrategyLedgerEventInput] {
  const sample = checkpoint.latestSample;
  const decision = checkpoint.latestDecision;
  const reconciliation = checkpoint.localReconciliation;
  const exitPlanId = decision.exitPlan?.planId ?? null;
  const common = Object.freeze({
    severity: decision.lifecyclePhase === 'HOLDING' ? 'info' : 'warning',
    source: 'engine.volume.strategy-economic-exit-shadow',
    strategy: 'volume_spike',
    symbol: sample.symbol,
    correlation: sample.entryProposalId,
    createdAt: decision.evaluatedAtMs,
  });
  return Object.freeze([
    Object.freeze({
      ...common,
      kind: VOLUME_ECONOMIC_EXIT_SAMPLED_EVENT_KIND,
      status: decision.disposition,
      reason: decision.primaryReason,
      message: 'Volume economic-exit shadow sample durably recorded without execution authority.',
      data: Object.freeze({
        schema: SAMPLED_EVENT_SCHEMA,
        checkpointRevision: checkpoint.revision,
        checkpointChecksum: checkpoint.checksum,
        sampleId: sample.sampleId,
        sampleRevision: sample.sampleRevision,
        decisionId: decision.decisionId,
        lifecyclePhase: decision.lifecyclePhase,
        disposition: decision.disposition,
        exitPlanId,
        executionAuthority: 'NONE',
        sendEligible: false,
        sends: 0,
        sideEffects: 0,
      }),
    }),
    Object.freeze({
      ...common,
      kind: VOLUME_ECONOMIC_EXIT_RECONCILED_EVENT_KIND,
      status: reconciliation.status,
      reason: reconciliation.reasonCodes[0] ?? null,
      message: 'Volume economic-exit local Ledger reconciliation durably recorded.',
      data: Object.freeze({
        schema: RECONCILED_EVENT_SCHEMA,
        checkpointRevision: checkpoint.revision,
        checkpointChecksum: checkpoint.checksum,
        reconciliationId: reconciliation.reconciliationId,
        sampleId: sample.sampleId,
        decisionId: decision.decisionId,
        status: reconciliation.status,
        executionAuthority: 'NONE',
        exchangeReconciliation: false,
        positionReconciliation: false,
        actualFillReconciliation: false,
        flatnessProven: false,
        sends: 0,
        sideEffects: 0,
      }),
    }),
  ]);
}

function normalizeLedgerEvent(value: unknown): Readonly<VolumeStrategyLedgerEventRecord> | null {
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
    if (committed.events.length !== 2) return null;
    const events: Readonly<VolumeStrategyLedgerEventRecord>[] = [];
    for (const value of committed.events) {
      const event = normalizeLedgerEvent(value);
      if (event === null) return null;
      events.push(event);
    }
    return Object.freeze({ committed: true, events: Object.freeze(events) });
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

function exactEventReceipts(
  events: readonly VolumeStrategyLedgerEventRecord[],
  expected: readonly VolumeStrategyLedgerEventInput[],
): boolean {
  if (events.length !== 2 || expected.length !== 2) return false;
  for (let index = 0; index < 2; index += 1) {
    const event = events[index];
    const input = expected[index];
    if (!event
        || !input
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
  return events[1]!.id > events[0]!.id && events[1]!.ts === events[0]!.ts;
}

function unavailableLoad(): VolumeEconomicExitCheckpointLoad {
  return Object.freeze({
    status: 'UNAVAILABLE',
    serialized: null,
    checkpoint: null,
    reasonCode: 'VOLUME_EXIT_SHADOW_LEDGER_UNAVAILABLE',
  });
}

function failedCommit(
  disposition: Extract<
    VolumeEconomicExitCheckpointCommit,
    { checkpoint: null }
  >['disposition'],
  reasonCode: string,
  current: VolumeEconomicExitCheckpointLoad,
): VolumeEconomicExitCheckpointCommit {
  return Object.freeze({
    disposition,
    checkpoint: null,
    eventIds: Object.freeze([]) as readonly [],
    reasonCode,
    current,
  });
}

export class VolumeEconomicExitLedgerAdapter {
  constructor(private readonly ledger: Readonly<VolumeStrategyLedgerPort>) {
    if (!ledger
        || typeof ledger.getConfigValue !== 'function'
        || typeof ledger.compareAndSetConfigValueAndLogEvents !== 'function') {
      throw new TypeError('Volume exit persistence requires the canonical Ledger CAS owner');
    }
  }

  load(): VolumeEconomicExitCheckpointLoad {
    let serialized: string | null;
    try {
      serialized = this.ledger.getConfigValue(VOLUME_ECONOMIC_EXIT_CONFIG_KEY);
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
    const checkpoint = decodeVolumeEconomicExitCheckpoint(serialized);
    if (checkpoint === null) {
      return Object.freeze({
        status: 'CORRUPT',
        serialized,
        checkpoint: null,
        reasonCode: 'VOLUME_EXIT_SHADOW_LEDGER_CORRUPT',
      });
    }
    return Object.freeze({
      status: 'AVAILABLE',
      serialized,
      checkpoint,
      reasonCode: null,
    });
  }

  commit(input: Readonly<VolumeEconomicExitCheckpointCommitInput>): VolumeEconomicExitCheckpointCommit {
    const fallback = unavailableLoad();
    const root = exactRecord(input, ['decision', 'expected', 'sample'])
      ?? exactRecord(input, ['commitBeforeMs', 'decision', 'expected', 'sample']);
    const expected = root === null ? null : normalizeExpectedLoad(root.expected);
    const commitBeforeMs = root?.commitBeforeMs as number | undefined;
    if (expected === null || !validCommitDeadline(commitBeforeMs)) {
      return failedCommit(
        'INVALID_REQUEST',
        'VOLUME_EXIT_SHADOW_LEDGER_COMMIT_INVALID',
        fallback,
      );
    }
    const state = normalizeState({
      sample: root?.sample,
      decision: root?.decision,
    });
    if (state === null) {
      return failedCommit(
        'INVALID_REQUEST',
        'VOLUME_EXIT_SHADOW_STATE_INVALID',
        expected,
      );
    }
    const priorRevision = expected.status === 'AVAILABLE' ? expected.checkpoint.revision : 0;
    if (priorRevision >= Number.MAX_SAFE_INTEGER) {
      return failedCommit(
        'VERSION_CONFLICT',
        'VOLUME_EXIT_SHADOW_LEDGER_REVISION_EXHAUSTED',
        expected,
      );
    }
    const candidate = createCheckpoint(priorRevision + 1, state.sample, state.decision);
    if (candidate === null) {
      return failedCommit(
        'INVALID_REQUEST',
        'VOLUME_EXIT_SHADOW_CHECKPOINT_INVALID',
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
      if (sameIdentity(expected.checkpoint, candidate)) {
        return failedCommit(
          'IDENTITY_CONFLICT',
          'VOLUME_EXIT_SHADOW_LEDGER_IDENTITY_CONFLICT',
          expected,
        );
      }
      const violation = transitionReason(expected.checkpoint, candidate);
      if (violation !== null) return failedCommit('VERSION_CONFLICT', violation, expected);
    } else if (state.sample.sampleRevision !== 1 || state.sample.previousSampleId !== null) {
      return failedCommit(
        'VERSION_CONFLICT',
        'VOLUME_EXIT_SHADOW_LEDGER_TRANSITION_INVALID',
        expected,
      );
    }

    let serialized: string;
    try {
      serialized = encodeVolumeEconomicExitCheckpoint(candidate);
    } catch {
      return failedCommit(
        'INVALID_REQUEST',
        'VOLUME_EXIT_SHADOW_CHECKPOINT_INVALID',
        expected,
      );
    }
    const records = eventInputs(candidate);
    let providerResult: unknown;
    try {
      providerResult = this.ledger.compareAndSetConfigValueAndLogEvents(
        VOLUME_ECONOMIC_EXIT_CONFIG_KEY,
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
          ? 'VOLUME_EXIT_SHADOW_LEDGER_CORRUPT'
          : 'VOLUME_EXIT_SHADOW_LEDGER_COMMIT_FAILED',
        readback,
      );
    }
    const result = normalizeCasResult(providerResult);
    if (result === null) {
      return failedCommit(
        'COMMIT_READBACK_INVALID',
        'VOLUME_EXIT_SHADOW_LEDGER_EVENT_READBACK_INVALID',
        this.load(),
      );
    }
    if (result.committed) {
      if (!exactEventReceipts(result.events, records)) {
        return failedCommit(
          'COMMIT_READBACK_INVALID',
          'VOLUME_EXIT_SHADOW_LEDGER_EVENT_READBACK_INVALID',
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
          'VOLUME_EXIT_SHADOW_LEDGER_CHECKPOINT_READBACK_INVALID',
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
        'VOLUME_EXIT_SHADOW_LEDGER_CORRUPT',
        winner,
      );
    }
    if (winner.status === 'UNAVAILABLE') {
      return failedCommit(
        'PERSISTENCE_UNAVAILABLE',
        'VOLUME_EXIT_SHADOW_LEDGER_UNAVAILABLE',
        winner,
      );
    }
    if (winner.status === 'AVAILABLE') {
      if (sameIdentity(winner.checkpoint, candidate)) {
        return failedCommit(
          'IDENTITY_CONFLICT',
          'VOLUME_EXIT_SHADOW_LEDGER_IDENTITY_CONFLICT',
          winner,
        );
      }
      const violation = transitionReason(winner.checkpoint, candidate);
      if (violation !== null) return failedCommit('VERSION_CONFLICT', violation, winner);
    }
    return failedCommit(
      result.reason,
      result.reason === 'VERSION_CONFLICT'
        ? 'VOLUME_EXIT_SHADOW_LEDGER_VERSION_CONFLICT'
        : 'VOLUME_EXIT_SHADOW_LEDGER_DEADLINE_EXCEEDED',
      winner,
    );
  }
}

export class VolumeEconomicExitLedgerCoordinator {
  private published: VolumeEconomicExitLedgerCoordinatorSnapshot = Object.freeze({
    status: 'EMPTY',
    checkpoint: null,
    reasonCode: null,
  });

  constructor(private readonly persistence: Readonly<VolumeEconomicExitLedgerAdapter>) {}

  restore(): VolumeEconomicExitLedgerRestoreResult {
    const current = this.persistence.load();
    if (current.status === 'EMPTY') {
      this.published = Object.freeze({
        status: 'EMPTY',
        checkpoint: null,
        reasonCode: null,
      });
      return Object.freeze({ status: 'EMPTY', checkpoint: null, reasonCode: null });
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
    readonly sample: Readonly<VolumeForwardExitSample>;
    readonly decision: Readonly<VolumeEconomicExitDecision>;
    readonly commitBeforeMs?: number;
  }>): VolumeEconomicExitCheckpointCommit {
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
    const root = exactRecord(input, ['decision', 'sample'])
      ?? exactRecord(input, ['commitBeforeMs', 'decision', 'sample']);
    if (root === null) {
      const result = failedCommit(
        'INVALID_REQUEST',
        'VOLUME_EXIT_SHADOW_LEDGER_COMMIT_INVALID',
        expected,
      );
      this.published = Object.freeze({
        status: 'BLOCKED',
        checkpoint: null,
        reasonCode: result.reasonCode ?? 'VOLUME_EXIT_SHADOW_LEDGER_COMMIT_INVALID',
      });
      return result;
    }
    const result = this.persistence.commit({
      expected,
      sample: root.sample as Readonly<VolumeForwardExitSample>,
      decision: root.decision as Readonly<VolumeEconomicExitDecision>,
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
      reasonCode: result.reasonCode ?? 'VOLUME_EXIT_SHADOW_LEDGER_COMMIT_FAILED',
    });
    return result;
  }

  snapshot(): VolumeEconomicExitLedgerCoordinatorSnapshot {
    return this.published;
  }
}

export function createVolumeEconomicExitLedgerCoordinator(
  ledger: Readonly<VolumeStrategyLedgerPort>,
): VolumeEconomicExitLedgerCoordinator {
  return new VolumeEconomicExitLedgerCoordinator(new VolumeEconomicExitLedgerAdapter(ledger));
}
