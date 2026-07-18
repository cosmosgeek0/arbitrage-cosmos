import type { SystemComponentId } from '../contracts/constants.js';
import type { SystemControlState } from '../contracts/types.js';
import {
  SYSTEM_PERSISTENCE_LIMITS,
  type PersistedApprovalReference,
  type PersistedDesiredComponentState,
  type PersistedDryRunExecutionReference,
  type PersistedReconciliationReference,
  type PersistedReservationReference,
  type PersistedRestartTruth,
  type RestartBarrierProjection,
  type SystemIntegrationCheckpointState,
} from './types.js';
import { canonicalPersistenceJson, cloneCheckpointState, persistenceDigest, validateCheckpointState } from './codec.js';
import { countPendingLiveEdgeControlIntents } from './liveEdgeControlCheckpoint.js';

const MAX_UTC_MS = 4_102_444_800_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

function assertUtc(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UTC_MS) throw new TypeError(`${name} must be valid UTC milliseconds`);
}

function assertIdentifier(value: string, name: string): void {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new TypeError(`${name} must be a bounded identifier`);
}

function finalize(state: SystemIntegrationCheckpointState): Readonly<SystemIntegrationCheckpointState> {
  const issues = validateCheckpointState(state);
  if (issues.length > 0) throw new TypeError(`checkpoint transition is invalid: ${issues.slice(0, 8).join(', ')}`);
  return cloneCheckpointState(state);
}

function next(
  current: Readonly<SystemIntegrationCheckpointState>,
  patch: Partial<SystemIntegrationCheckpointState>,
): SystemIntegrationCheckpointState {
  return {
    ...current,
    ...patch,
    revision: current.revision + 1,
  };
}

function replaceById<T>(
  values: readonly T[],
  incoming: T,
  id: (value: T) => string,
): readonly T[] {
  const incomingId = id(incoming);
  return [...values.filter((value) => id(value) !== incomingId), incoming]
    .sort((left, right) => id(left).localeCompare(id(right), 'en'));
}

export function createInitialCheckpointState(
  nowMs: number,
  correlationId = 'system-integration-cold-start',
): Readonly<SystemIntegrationCheckpointState> {
  assertUtc(nowMs, 'nowMs');
  assertIdentifier(correlationId, 'correlationId');
  const control: SystemControlState = {
    revision: 0,
    generation: 0,
    safeMode: 'READ_ONLY',
    killSwitchEngaged: true,
    intakePaused: true,
    updatedAtMs: nowMs,
    correlationId,
  };
  return finalize({
    revision: 0,
    generation: 0,
    control,
    strategyIntake: {
      basisPaused: false,
      volumePaused: false,
    },
    desiredComponents: [],
    authorityReferences: [],
    reservations: [],
    approvals: [],
    dryRunExecutions: [],
    reconciliations: [],
    idempotencyReceipts: [],
    liveEdgeControlEvents: [],
    controlRejections: [],
    traceIndex: [],
    restartTruth: {
      publicSourceTruth: 'UNKNOWN',
      accountTruth: 'UNKNOWN',
      reconciliationTruth: 'UNKNOWN',
      observedAtMs: null,
    },
    lastStartup: null,
    lastShutdown: null,
  });
}

export function failClosedRestartBarrier(
  nowMs: number,
  reasonCode: string,
): Readonly<RestartBarrierProjection> {
  assertUtc(nowMs, 'nowMs');
  return Object.freeze({
    evaluatedAtMs: nowMs,
    canOpenOrIncrease: false,
    supervisionContinues: true as const,
    reasonCodes: Object.freeze([reasonCode]),
    activeReservationIds: Object.freeze([]),
    usableApprovalIds: Object.freeze([]),
    reconciliationRequiredPlanIds: Object.freeze([]),
  });
}

export function evaluateRestartBarrier(
  state: Readonly<SystemIntegrationCheckpointState>,
  nowMs: number,
): Readonly<RestartBarrierProjection> {
  assertUtc(nowMs, 'nowMs');
  const issues = validateCheckpointState(state);
  if (issues.length > 0) return failClosedRestartBarrier(nowMs, 'CHECKPOINT_INVALID');
  const reasons = new Set<string>();
  if ((countPendingLiveEdgeControlIntents(state.liveEdgeControlEvents) ?? 0) > 0) {
    reasons.add('PENDING_LIVE_EDGE_CONTROL_INTENT');
  }
  if (state.lastStartup === null || state.lastStartup.generation !== state.generation) reasons.add('STARTUP_NOT_RECORDED');
  if (state.restartTruth.publicSourceTruth !== 'FRESH') reasons.add(`PUBLIC_SOURCE_TRUTH_${state.restartTruth.publicSourceTruth}`);
  if (state.restartTruth.accountTruth !== 'FRESH') reasons.add(`ACCOUNT_TRUTH_${state.restartTruth.accountTruth}`);
  if (state.restartTruth.reconciliationTruth !== 'FRESH') reasons.add(`RECONCILIATION_TRUTH_${state.restartTruth.reconciliationTruth}`);
  const truthAt = state.restartTruth.observedAtMs;
  if (truthAt === null) reasons.add('RESTART_TRUTH_TIME_UNKNOWN');
  else if (truthAt > nowMs) reasons.add('RESTART_TRUTH_CLOCK_SKEWED');
  else if (nowMs - truthAt > SYSTEM_PERSISTENCE_LIMITS.restartTruthMaximumAgeMs) reasons.add('RESTART_TRUTH_STALE');

  const reconciliationRequiredPlanIds = new Set<string>();
  for (const execution of state.dryRunExecutions) {
    const reconciliation = state.reconciliations.find((entry) => entry.planId === execution.planId);
    if (execution.requiresReconciliation && (!reconciliation || !reconciliation.allowsNewExposure)) {
      reasons.add('DRY_RUN_EXECUTION_RECONCILIATION_REQUIRED');
      reconciliationRequiredPlanIds.add(execution.planId);
    }
  }
  for (const reconciliation of state.reconciliations) {
    if (!reconciliation.allowsNewExposure) {
      reasons.add('RECONCILIATION_BLOCKS_NEW_EXPOSURE');
      reconciliationRequiredPlanIds.add(reconciliation.planId);
    }
  }

  const activeReservationIds = state.reservations
    .filter((reference) => reference.blocksAllocation)
    .map((reference) => reference.reservationId)
    .sort();
  const usableApprovalIds = state.approvals
    .filter((reference) => reference.usable && (reference.expiresAtMs === null || reference.expiresAtMs > nowMs))
    .map((reference) => reference.approvalId)
    .sort();
  return Object.freeze({
    evaluatedAtMs: nowMs,
    canOpenOrIncrease: reasons.size === 0,
    supervisionContinues: true as const,
    reasonCodes: Object.freeze([...reasons].sort()),
    activeReservationIds: Object.freeze(activeReservationIds),
    usableApprovalIds: Object.freeze(usableApprovalIds),
    reconciliationRequiredPlanIds: Object.freeze([...reconciliationRequiredPlanIds].sort()),
  });
}

export function prepareStartupState(
  current: Readonly<SystemIntegrationCheckpointState>,
  input: { readonly startedAtMs: number; readonly correlationId: string },
): Readonly<SystemIntegrationCheckpointState> {
  assertUtc(input.startedAtMs, 'startedAtMs');
  assertIdentifier(input.correlationId, 'correlationId');
  const generation = current.generation + 1;
  return finalize(next(current, {
    generation,
    control: {
      ...current.control,
      generation,
      updatedAtMs: input.startedAtMs,
      correlationId: input.correlationId,
    },
    restartTruth: {
      publicSourceTruth: 'UNKNOWN',
      accountTruth: 'UNKNOWN',
      reconciliationTruth: 'UNKNOWN',
      observedAtMs: null,
    },
    lastStartup: {
      generation,
      startedAtMs: input.startedAtMs,
      correlationId: input.correlationId,
      restoredFromRevision: current.revision,
    },
  }));
}

export function withRestartTruth(
  current: Readonly<SystemIntegrationCheckpointState>,
  truth: Readonly<PersistedRestartTruth>,
): Readonly<SystemIntegrationCheckpointState> {
  return finalize(next(current, { restartTruth: truth }));
}

export function withDesiredComponentState(
  current: Readonly<SystemIntegrationCheckpointState>,
  desired: Readonly<PersistedDesiredComponentState>,
): Readonly<SystemIntegrationCheckpointState> {
  return finalize(next(current, {
    desiredComponents: replaceById(current.desiredComponents, desired, (entry) => entry.componentId),
  }));
}

export function upsertReservationReference(
  current: Readonly<SystemIntegrationCheckpointState>,
  reference: Readonly<PersistedReservationReference>,
): Readonly<SystemIntegrationCheckpointState> {
  const existing = current.reservations.find((entry) => entry.reservationId === reference.reservationId);
  if (existing && !existing.blocksAllocation && reference.blocksAllocation) {
    throw new Error('RESERVATION_RESURRECTION_FORBIDDEN');
  }
  const competing = current.reservations.find((entry) => (
    entry.reservationId !== reference.reservationId
    && entry.allocationKey === reference.allocationKey
    && entry.blocksAllocation
    && reference.blocksAllocation
  ));
  if (competing) throw new Error('DUPLICATE_ACTIVE_RESERVATION');
  if (existing && canonicalPersistenceJson(existing) === canonicalPersistenceJson(reference)) return current;
  return finalize(next(current, {
    reservations: replaceById(current.reservations, reference, (entry) => entry.reservationId),
  }));
}

export function upsertApprovalReference(
  current: Readonly<SystemIntegrationCheckpointState>,
  reference: Readonly<PersistedApprovalReference>,
): Readonly<SystemIntegrationCheckpointState> {
  const existing = current.approvals.find((entry) => entry.approvalId === reference.approvalId);
  if (existing && !existing.usable && reference.usable) throw new Error('APPROVAL_RESURRECTION_FORBIDDEN');
  if (existing && canonicalPersistenceJson(existing) === canonicalPersistenceJson(reference)) return current;
  return finalize(next(current, {
    approvals: replaceById(current.approvals, reference, (entry) => entry.approvalId),
  }));
}

export function upsertDryRunExecutionReference(
  current: Readonly<SystemIntegrationCheckpointState>,
  reference: Readonly<PersistedDryRunExecutionReference>,
): Readonly<SystemIntegrationCheckpointState> {
  if (reference.dryRun !== true) throw new Error('LIVE_EXECUTION_REFERENCE_FORBIDDEN');
  const existing = current.dryRunExecutions.find((entry) => entry.planId === reference.planId);
  if (existing && canonicalPersistenceJson(existing) === canonicalPersistenceJson(reference)) return current;
  return finalize(next(current, {
    dryRunExecutions: replaceById(current.dryRunExecutions, reference, (entry) => entry.planId),
  }));
}

export function upsertReconciliationReference(
  current: Readonly<SystemIntegrationCheckpointState>,
  reference: Readonly<PersistedReconciliationReference>,
): Readonly<SystemIntegrationCheckpointState> {
  const existing = current.reconciliations.find((entry) => entry.planId === reference.planId);
  if (existing && canonicalPersistenceJson(existing) === canonicalPersistenceJson(reference)) return current;
  return finalize(next(current, {
    reconciliations: replaceById(current.reconciliations, reference, (entry) => entry.planId),
  }));
}

export function prepareShutdownState(
  current: Readonly<SystemIntegrationCheckpointState>,
  input: {
    readonly stoppedAtMs: number;
    readonly correlationId: string;
    readonly clean: boolean;
    readonly componentStates: readonly Readonly<Pick<PersistedDesiredComponentState, 'componentId' | 'desiredState' | 'generation'>>[];
  },
): Readonly<SystemIntegrationCheckpointState> {
  assertUtc(input.stoppedAtMs, 'stoppedAtMs');
  assertIdentifier(input.correlationId, 'correlationId');
  return finalize(next(current, {
    lastShutdown: {
      generation: current.generation,
      stoppedAtMs: input.stoppedAtMs,
      correlationId: input.correlationId,
      clean: input.clean,
      finalComponentStateDigest: persistenceDigest(
        [...input.componentStates].sort((left, right) => left.componentId.localeCompare(right.componentId, 'en')),
      ),
    },
  }));
}

export function componentStateDigest(
  states: readonly Readonly<{ componentId: SystemComponentId; desiredState: string; generation: number }>[],
): string {
  return persistenceDigest([...states].sort((left, right) => left.componentId.localeCompare(right.componentId, 'en')));
}
