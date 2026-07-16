import {
  evaluateFreshness,
  isValidUtcMillis,
} from '../../foundation/contracts/index.js';
import {
  SYSTEM_COMPONENT_IDS,
  validateSystemComponentSnapshot,
} from '../contracts/index.js';
import type { SystemComponentSnapshot } from '../contracts/index.js';
import { canonicalApplicationComponentOwner } from '../application/projection.js';
import type { PersistedRestartTruth, PersistedTruthState } from '../persistence/types.js';
import { SYSTEM_PERSISTENCE_LIMITS } from '../persistence/types.js';
import type { SystemSupervisorReadModel } from '../supervisor/types.js';
import { isCanonicalSupervisorOpsReadback } from './intakeGate.js';
import {
  OPS_STRONG_ACCOUNT_TRUTH_STATES,
  type CanonicalSupervisorOpsReadback,
  type CanonicalSupervisorOpsClock,
} from './types.js';

const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const MIN_OPS_LEASE_MS = 5 * 60_000;
const MAX_OPS_LEASE_MS = 60 * 60_000;
const RESTART_TRUTH_COMPONENT_IDS = Object.freeze([
  'public-spot-source',
  'public-usdm-source',
  'capital-supervision',
  'reconciliation',
] as const);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unavailable(nowMs: number): Readonly<PersistedRestartTruth> {
  return Object.freeze({
    publicSourceTruth: 'UNKNOWN',
    accountTruth: 'UNAVAILABLE',
    reconciliationTruth: 'UNKNOWN',
    observedAtMs: nowMs,
  });
}

function exactUtcSeconds(value: unknown): number | null {
  if (typeof value !== 'string' || !UTC_SECONDS.test(value)) return null;
  const parsed = Date.parse(value);
  if (!isValidUtcMillis(parsed)) return null;
  return new Date(parsed).toISOString().replace('.000Z', 'Z') === value ? parsed : null;
}

function currentSupervisor(value: unknown, nowMs: number): value is Readonly<SystemSupervisorReadModel> {
  if (!record(value) || !isValidUtcMillis(value.evaluatedAtMs)) return false;
  if (value.evaluatedAtMs > nowMs) return false;
  if (nowMs - value.evaluatedAtMs > SYSTEM_PERSISTENCE_LIMITS.restartTruthMaximumAgeMs) return false;
  if (!Array.isArray(value.components) || !record(value.summaries)) return false;
  const components = value.components;
  if (components.length !== SYSTEM_COMPONENT_IDS.length) return false;
  const componentIds = components.map((entry) => record(entry) ? entry.componentId : null);
  if (new Set(componentIds).size !== SYSTEM_COMPONENT_IDS.length) return false;
  if (SYSTEM_COMPONENT_IDS.some((componentId) => !componentIds.includes(componentId))) return false;
  if (components.some((entry) => validateSystemComponentSnapshot(entry).length > 0)) return false;
  return RESTART_TRUTH_COMPONENT_IDS.every((componentId) => {
    const snapshot = components.find(
      (entry) => record(entry) && entry.componentId === componentId,
    ) as Readonly<SystemComponentSnapshot> | undefined;
    return snapshot?.owner === canonicalApplicationComponentOwner(componentId);
  });
}

function currentOps(value: unknown, nowMs: number): value is Readonly<CanonicalSupervisorOpsReadback> {
  if (!isCanonicalSupervisorOpsReadback(value)) return false;
  const observedAtMs = exactUtcSeconds(value.observedAtUtc);
  const validUntilMs = exactUtcSeconds(value.validUntilUtc);
  if (observedAtMs === null || validUntilMs === null || validUntilMs <= observedAtMs) return false;
  const leaseMs = validUntilMs - observedAtMs;
  return observedAtMs <= nowMs
    && nowMs - observedAtMs <= SYSTEM_PERSISTENCE_LIMITS.restartTruthMaximumAgeMs
    && validUntilMs > nowMs
    && leaseMs >= MIN_OPS_LEASE_MS
    && leaseMs <= MAX_OPS_LEASE_MS;
}

function component(
  supervisor: Readonly<SystemSupervisorReadModel>,
  componentId: string,
): Readonly<SystemComponentSnapshot> | null {
  const value = supervisor.components.find((entry) => entry.componentId === componentId);
  return value ?? null;
}

function explicitUnavailable(...values: unknown[]): boolean {
  return values.some((value) => (
    value === 'UNAVAILABLE'
    || value === 'NOT_CONFIGURED'
    || value === 'MISSING'
    || value === 'FAILED'
  ));
}

function staleOwner(owner: Readonly<SystemComponentSnapshot> | null): boolean {
  return owner?.freshness?.state === 'STALE';
}

function publicSourceTruth(
  supervisor: Readonly<SystemSupervisorReadModel>,
  nowMs: number,
): PersistedTruthState {
  const sources = [
    component(supervisor, 'public-spot-source'),
    component(supervisor, 'public-usdm-source'),
  ];
  if (sources.some((source) => source === null)) return 'UNKNOWN';
  if (sources.some((source) => explicitUnavailable(
    source?.truthLabel,
    source?.authority,
    source?.completeness,
    source?.readiness,
  ))) return 'UNAVAILABLE';
  if (sources.some((source) => staleOwner(source))) return 'STALE';
  if (sources.every((source) => (
    source?.truthLabel === 'LIVE_PUBLIC'
    && source.authority === 'LIVE_PUBLIC'
    && source.completeness === 'COMPLETE'
    && source.readiness === 'READY'
    && source.freshness !== null
    && source.sourceTimestamp !== null
    && evaluateFreshness(source.sourceTimestamp, nowMs).state === 'FRESH'
  ))) return 'FRESH';
  return 'UNKNOWN';
}

function accountTruth(
  supervisor: Readonly<SystemSupervisorReadModel>,
  ops: Readonly<CanonicalSupervisorOpsReadback> | null,
): PersistedTruthState {
  const owner = component(supervisor, 'capital-supervision');
  const summary = record(supervisor.summaries.capital) ? supervisor.summaries.capital : null;
  if (owner === null || summary === null) return 'UNKNOWN';
  if (explicitUnavailable(owner.truthLabel, owner.readiness, summary.truthLabel, summary.accountTruthState)) {
    return 'UNAVAILABLE';
  }
  if (staleOwner(owner)) return 'STALE';
  if (ops === null) return 'UNKNOWN';
  const strongZero = ops.exposureState === 'NONE'
    && ops.ambiguityState === 'NONE'
    && ops.recoveryState === 'NONE';
  return strongZero
    && owner.truthLabel === 'RECORDED_REPLAY'
    && owner.readiness === 'READY'
    && owner.completeness === 'COMPLETE'
    && summary.truthLabel === 'RECORDED_REPLAY'
    && OPS_STRONG_ACCOUNT_TRUTH_STATES.includes(
      summary.accountTruthState as (typeof OPS_STRONG_ACCOUNT_TRUTH_STATES)[number],
    )
    ? 'FRESH'
    : 'UNKNOWN';
}

function reconciliationTruth(
  supervisor: Readonly<SystemSupervisorReadModel>,
  ops: Readonly<CanonicalSupervisorOpsReadback> | null,
  nowMs: number,
): PersistedTruthState {
  const owner = component(supervisor, 'reconciliation');
  const summary = record(supervisor.summaries.reconciliation)
    ? supervisor.summaries.reconciliation
    : null;
  if (owner === null || summary === null) return 'UNKNOWN';
  if (explicitUnavailable(owner.truthLabel, owner.readiness, summary.truthLabel, summary.status)) {
    return 'UNAVAILABLE';
  }
  if (staleOwner(owner)) return 'STALE';
  if (isValidUtcMillis(summary.evaluatedAtMs)
    && nowMs - summary.evaluatedAtMs > SYSTEM_PERSISTENCE_LIMITS.restartTruthMaximumAgeMs) return 'STALE';
  if (ops === null) return 'UNKNOWN';
  const strongZero = ops.exposureState === 'NONE'
    && ops.ambiguityState === 'NONE'
    && ops.recoveryState === 'NONE';
  const currentEvaluation = isValidUtcMillis(summary.evaluatedAtMs)
    && summary.evaluatedAtMs <= nowMs
    && nowMs - summary.evaluatedAtMs <= SYSTEM_PERSISTENCE_LIMITS.restartTruthMaximumAgeMs;
  return strongZero
    && owner.readiness === 'READY'
    && owner.completeness === 'COMPLETE'
    && ['RECORDED_REPLAY', 'DRY_RUN'].includes(String(owner.truthLabel))
    && ['RECORDED_REPLAY', 'DRY_RUN'].includes(String(summary.truthLabel))
    && summary.status === 'EXACT'
    && summary.blocksNewExposure === false
    && currentEvaluation
    ? 'FRESH'
    : 'UNKNOWN';
}

export function projectCanonicalRestartTruth(
  supervisor: unknown,
  opsReadback: unknown,
  nowMs: number,
): Readonly<PersistedRestartTruth> {
  if (!isValidUtcMillis(nowMs) || !currentSupervisor(supervisor, nowMs)) {
    if (!isValidUtcMillis(nowMs)) throw new TypeError('restart truth projection requires valid UTC milliseconds');
    return unavailable(nowMs);
  }
  const ops = currentOps(opsReadback, nowMs) ? opsReadback : null;
  return Object.freeze({
    publicSourceTruth: publicSourceTruth(supervisor, nowMs),
    accountTruth: accountTruth(supervisor, ops),
    reconciliationTruth: reconciliationTruth(supervisor, ops, nowMs),
    observedAtMs: nowMs,
  });
}

export interface CanonicalRestartTruthCoordinatorOptions {
  readonly clock: CanonicalSupervisorOpsClock;
  readonly readSupervisor: () => (
    Readonly<SystemSupervisorReadModel>
    | Promise<Readonly<SystemSupervisorReadModel>>
  );
  readonly readOps: (
    supervisorCut: Readonly<SystemSupervisorReadModel>,
  ) => (
    Readonly<CanonicalSupervisorOpsReadback>
    | Promise<Readonly<CanonicalSupervisorOpsReadback>>
  );
}

export interface CanonicalRestartTruthCoordinator {
  readRestartTruth(nowMs: number): Readonly<PersistedRestartTruth>;
  refreshRestartTruth(nowMs: number): Promise<Readonly<PersistedRestartTruth>>;
}

class RestartTruthCoordinator implements CanonicalRestartTruthCoordinator {
  private latest: Readonly<PersistedRestartTruth> | null = null;

  constructor(private readonly options: CanonicalRestartTruthCoordinatorOptions) {}

  readRestartTruth(nowMs: number): Readonly<PersistedRestartTruth> {
    if (!isValidUtcMillis(nowMs)) throw new TypeError('restart truth read requires valid UTC milliseconds');
    return this.latest ?? unavailable(nowMs);
  }

  async refreshRestartTruth(nowMs: number): Promise<Readonly<PersistedRestartTruth>> {
    if (!isValidUtcMillis(nowMs)) throw new TypeError('restart truth refresh requires valid UTC milliseconds');
    const supervisorCut = await this.options.readSupervisor();
    const opsReadback = await this.options.readOps(supervisorCut);
    const observedAtMs = this.options.clock.nowMs();
    if (!isValidUtcMillis(observedAtMs) || observedAtMs < nowMs) {
      throw new TypeError('restart truth refresh clock regressed or returned invalid UTC milliseconds');
    }
    const projected = projectCanonicalRestartTruth(supervisorCut, opsReadback, observedAtMs);
    this.latest = projected;
    return projected;
  }
}

export function createCanonicalRestartTruthCoordinator(
  options: CanonicalRestartTruthCoordinatorOptions,
): CanonicalRestartTruthCoordinator {
  if (!options
    || typeof options.clock?.nowMs !== 'function'
    || typeof options.readSupervisor !== 'function'
    || typeof options.readOps !== 'function') {
    throw new TypeError('canonical restart truth requires supervisor and ops read ports');
  }
  return new RestartTruthCoordinator(options);
}
