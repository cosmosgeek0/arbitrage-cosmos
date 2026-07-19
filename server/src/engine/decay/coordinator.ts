import { isValidUtcMillis } from '../../foundation/contracts/index.js';
import {
  deriveStrategyDecayMeasurementId,
  deriveStrategyDecayPolicyRevision,
  evaluateStrategyDecayGovernance,
  snapshotStrategyDecayData,
  validateStrategyDecayHistoryState,
  validateStrategyDecayMeasurement,
} from './governance.js';
import {
  StrategyDecayLedgerAdapter,
  type StrategyDecayHistoryCommit,
} from './ledger.js';
import {
  STRATEGY_DECAY_AXES,
  STRATEGY_DECAY_MEASUREMENT_SCHEMA,
  STRATEGY_DECAY_MEASUREMENT_SCHEMA_VERSION,
  type StrategyDecayAxisAssessment,
  type StrategyDecayGovernancePolicy,
  type StrategyDecayHistoryState,
  type StrategyDecayMeasurement,
  type StrategyDecaySource,
} from './types.js';

const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

/** One UTC day. Existing Engine ticks drive this due check; it owns no timer. */
export const STRATEGY_DECAY_EVALUATION_INTERVAL_MS = 24 * 60 * 60_000;

const GOVERNANCE_SEMANTICS = Object.freeze({
  policyId: 'engine.strategy-decay.production.v1',
  reduceAfterConsecutiveDegradedWindows: 1,
  disableAfterConsecutiveDeadWindows: 2,
  retireAfterConsecutiveDeadWindows: 3,
  maximumRecentDecisions: 32,
});

/** Immutable Engine-owned governance semantics for the mounted path. */
export const STRATEGY_DECAY_PRODUCTION_POLICY: Readonly<StrategyDecayGovernancePolicy> = Object.freeze({
  ...GOVERNANCE_SEMANTICS,
  policyRevision: deriveStrategyDecayPolicyRevision(GOVERNANCE_SEMANTICS),
});

export interface StrategyDecayCoordinatorRequest {
  readonly strategy: StrategyDecaySource;
  readonly configVersion: string;
  readonly direction: string;
  /** Reuses the owning Engine tick time; the coordinator never reads a clock. */
  readonly evaluatedAtMs: number;
}

/** Narrow content copied into the Capital-owned allocation posture projection. */
export interface StrategyDecayCoordinatorPostureSource {
  readonly strategy: StrategyDecaySource;
  readonly configVersion: string;
  readonly direction: string;
  readonly effectivePosture: 'ENABLED' | 'REDUCED' | 'DISABLED' | 'RETIRED';
  readonly latestMeasurementState: 'UNKNOWN' | 'STABLE' | 'DEGRADED' | 'DEAD';
  readonly decisionId: string;
  readonly measurementId: string;
  readonly policyRevision: string;
  readonly historyRevision: number;
  readonly evaluatedAtMs: number;
  readonly validUntilMs: number;
  readonly historyDigest: string;
}

/** Cached owner read projection. It must not perform network or signed I/O. */
export interface StrategyDecayPerformanceMeasurementPort {
  readPerformanceMeasurement(
    request: Readonly<StrategyDecayCoordinatorRequest>,
  ): Readonly<StrategyDecayMeasurement> | null;
}

export class UnavailableStrategyDecayPerformanceMeasurementPort
implements StrategyDecayPerformanceMeasurementPort {
  readPerformanceMeasurement(): null {
    return null;
  }
}

export type StrategyDecayCoordinatorResult =
  | {
      readonly disposition: 'COMMITTED_NEW' | 'ALREADY_COMMITTED';
      readonly state: Readonly<StrategyDecayHistoryState>;
      readonly measurement: Readonly<StrategyDecayMeasurement>;
      readonly commit: StrategyDecayHistoryCommit;
      readonly reasonCodes: readonly string[];
    }
  | {
      readonly disposition: 'NOT_DUE';
      readonly state: Readonly<StrategyDecayHistoryState>;
      readonly measurement: null;
      readonly commit: null;
      readonly reasonCodes: readonly string[];
    }
  | {
      readonly disposition: 'BLOCKED';
      readonly state: Readonly<StrategyDecayHistoryState> | null;
      readonly measurement: Readonly<StrategyDecayMeasurement> | null;
      readonly commit: StrategyDecayHistoryCommit | null;
      readonly reasonCodes: readonly string[];
    };

function freeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function reasonList(...values: string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function snapshotRequest(value: unknown): Readonly<StrategyDecayCoordinatorRequest> | null {
  const request = snapshotStrategyDecayData(value);
  if (request === null || typeof request !== 'object' || Array.isArray(request)) return null;
  const keys = Object.keys(request);
  if (keys.length !== 4
    || !['strategy', 'configVersion', 'direction', 'evaluatedAtMs'].every((key) => keys.includes(key))) return null;
  const canonical = request as unknown as StrategyDecayCoordinatorRequest;
  return (canonical.strategy === 'BASIS' || canonical.strategy === 'VOLUME')
    && typeof canonical.configVersion === 'string'
    && LABEL.test(canonical.configVersion)
    && typeof canonical.direction === 'string'
    && LABEL.test(canonical.direction)
    && isValidUtcMillis(canonical.evaluatedAtMs)
    && !Object.is(canonical.evaluatedAtMs, -0)
    && canonical.evaluatedAtMs >= 2 * STRATEGY_DECAY_EVALUATION_INTERVAL_MS
    ? canonical
    : null;
}

function unknownMeasurement(
  request: Readonly<StrategyDecayCoordinatorRequest>,
  reasonCode: string,
): Readonly<StrategyDecayMeasurement> {
  const interval = STRATEGY_DECAY_EVALUATION_INTERVAL_MS;
  const axes = STRATEGY_DECAY_AXES.map((axis): Readonly<StrategyDecayAxisAssessment> => Object.freeze({
    axis,
    state: 'UNKNOWN',
    baselineSampleCount: 0,
    currentSampleCount: 0,
    baselineValue: null,
    currentValue: null,
    unit: axis === 'CLOSED_OUTCOME_NET_VALUE' ? 'QUOTE_ASSET' : 'RATIO',
    reasonCodes: Object.freeze([reasonCode]),
    evidenceIds: Object.freeze([]),
  }));
  const material: Omit<StrategyDecayMeasurement, 'measurementId'> = freeze({
    schema: STRATEGY_DECAY_MEASUREMENT_SCHEMA,
    schemaVersion: STRATEGY_DECAY_MEASUREMENT_SCHEMA_VERSION,
    strategy: request.strategy,
    configVersion: request.configVersion,
    direction: request.direction,
    evaluatedAtMs: request.evaluatedAtMs,
    evidenceAuthority: 'UNKNOWN',
    baselineWindow: Object.freeze({
      startAtMs: request.evaluatedAtMs - (2 * interval),
      endAtMs: request.evaluatedAtMs - interval,
    }),
    currentWindow: Object.freeze({
      startAtMs: request.evaluatedAtMs - interval,
      endAtMs: request.evaluatedAtMs,
    }),
    axes: Object.freeze(axes),
    state: 'UNKNOWN',
    reasonCodes: Object.freeze([reasonCode]),
  });
  return freeze({ ...material, measurementId: deriveStrategyDecayMeasurementId(material) });
}

function measurementFor(
  port: StrategyDecayPerformanceMeasurementPort,
  request: Readonly<StrategyDecayCoordinatorRequest>,
): Readonly<StrategyDecayMeasurement> {
  let candidate: Readonly<StrategyDecayMeasurement> | null;
  try {
    candidate = port.readPerformanceMeasurement(request);
  } catch {
    return unknownMeasurement(request, 'PERFORMANCE_EVIDENCE_READ_FAILED');
  }
  if (candidate === null) return unknownMeasurement(request, 'PERFORMANCE_EVIDENCE_UNAVAILABLE');
  const snapshot = snapshotStrategyDecayData(candidate);
  if (snapshot === null || validateStrategyDecayMeasurement(snapshot).length > 0) {
    return unknownMeasurement(request, 'PERFORMANCE_EVIDENCE_INVALID');
  }
  const canonical = snapshot as unknown as Readonly<StrategyDecayMeasurement>;
  if (canonical.strategy !== request.strategy
    || canonical.configVersion !== request.configVersion
    || canonical.direction !== request.direction
    || canonical.evaluatedAtMs !== request.evaluatedAtMs) {
    return unknownMeasurement(request, 'PERFORMANCE_EVIDENCE_SCOPE_MISMATCH');
  }
  return canonical;
}

export function projectStrategyDecayCoordinatorPosture(
  state: Readonly<StrategyDecayHistoryState>,
): Readonly<StrategyDecayCoordinatorPostureSource> | null {
  const snapshot = snapshotStrategyDecayData(state);
  if (snapshot === null || validateStrategyDecayHistoryState(snapshot).length > 0) return null;
  const canonical = snapshot as unknown as StrategyDecayHistoryState;
  const latest = canonical.recentDecisions.at(-1);
  if (latest === undefined) return null;
  const validUntilMs = canonical.updatedAtMs + STRATEGY_DECAY_EVALUATION_INTERVAL_MS;
  if (!isValidUtcMillis(validUntilMs) || validUntilMs <= canonical.updatedAtMs) return null;
  return freeze({
    strategy: canonical.strategy,
    configVersion: canonical.configVersion,
    direction: canonical.direction,
    effectivePosture: canonical.effectivePosture,
    latestMeasurementState: latest.measurementState,
    decisionId: latest.decisionId,
    measurementId: latest.measurementId,
    policyRevision: canonical.policyRevision,
    historyRevision: canonical.revision,
    evaluatedAtMs: canonical.updatedAtMs,
    validUntilMs,
    historyDigest: canonical.historyDigest,
  });
}

/**
 * Existing-cadence coordinator. It reads one cached measurement, evaluates the
 * immutable policy, and persists with the sole Ledger CAS. It owns no clock,
 * timer, scheduler, socket, environment access, or execution capability.
 */
export class StrategyDecayCoordinator {
  constructor(
    private readonly ledger: StrategyDecayLedgerAdapter,
    private readonly measurements: StrategyDecayPerformanceMeasurementPort,
  ) {}

  tick(request: Readonly<StrategyDecayCoordinatorRequest>): StrategyDecayCoordinatorResult {
    const canonicalRequest = snapshotRequest(request);
    if (canonicalRequest === null) {
      return Object.freeze({
        disposition: 'BLOCKED', state: null, measurement: null, commit: null,
        reasonCodes: reasonList('DECAY_COORDINATOR_REQUEST_INVALID'),
      });
    }

    let measurement: Readonly<StrategyDecayMeasurement> | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = this.ledger.load(canonicalRequest.strategy, canonicalRequest.direction);
      if (current.status === 'MALFORMED' || current.status === 'UNAVAILABLE') {
        return Object.freeze({
          disposition: 'BLOCKED', state: null, measurement, commit: null,
          reasonCodes: reasonList(current.reasonCode ?? 'DECAY_HISTORY_UNAVAILABLE'),
        });
      }
      const previous = current.state;
      if (previous !== null && canonicalRequest.evaluatedAtMs <= previous.updatedAtMs) {
        return Object.freeze({
          disposition: 'NOT_DUE', state: previous, measurement: null, commit: null,
          reasonCodes: reasonList('DECAY_EVALUATION_TIME_NOT_NEWER'),
        });
      }
      if (previous !== null
        && canonicalRequest.evaluatedAtMs - previous.updatedAtMs < STRATEGY_DECAY_EVALUATION_INTERVAL_MS) {
        return Object.freeze({
          disposition: 'NOT_DUE', state: previous, measurement: null, commit: null,
          reasonCodes: reasonList('DECAY_EVALUATION_INTERVAL_NOT_ELAPSED'),
        });
      }

      measurement ??= measurementFor(this.measurements, canonicalRequest);
      const evaluation = evaluateStrategyDecayGovernance({
        policy: STRATEGY_DECAY_PRODUCTION_POLICY,
        measurement,
        previousState: previous,
      });
      if (!evaluation.ok) {
        return Object.freeze({
          disposition: 'BLOCKED', state: previous, measurement, commit: null,
          reasonCodes: evaluation.reasonCodes,
        });
      }
      const commit = this.ledger.commit({
        expectedSerialized: current.serialized,
        decision: evaluation.decision,
        nextState: evaluation.nextState,
      });
      if (commit.disposition === 'COMMITTED_NEW' || commit.disposition === 'ALREADY_COMMITTED') {
        return Object.freeze({
          disposition: commit.disposition,
          state: commit.state,
          measurement,
          commit,
          reasonCodes: Object.freeze([]),
        });
      }
      if (commit.disposition === 'VERSION_CONFLICT' && attempt === 0) continue;
      return Object.freeze({
        disposition: 'BLOCKED', state: previous, measurement, commit,
        reasonCodes: reasonList('reasonCode' in commit ? commit.reasonCode : 'DECAY_COORDINATOR_COMMIT_INVALID'),
      });
    }
    return Object.freeze({
      disposition: 'BLOCKED', state: null, measurement, commit: null,
      reasonCodes: reasonList('DECAY_COORDINATOR_RETRY_EXHAUSTED'),
    });
  }
}
