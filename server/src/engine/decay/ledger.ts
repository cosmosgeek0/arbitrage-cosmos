import {
  canonicalJson,
  stableHash128Hex,
} from '../../foundation/contracts/index.js';
import {
  snapshotStrategyDecayData,
  strategyDecayStateFromDecision,
  summarizeStrategyDecayDecision,
  validateStrategyDecayDecision,
  validateStrategyDecayHistoryState,
} from './governance.js';
import {
  STRATEGY_DECAY_POSTURES,
  STRATEGY_DECAY_SOURCES,
  type StrategyDecayDecisionKind,
  type StrategyDecayDecision,
  type StrategyDecayHistoryState,
  type StrategyDecayPosture,
  type StrategyDecaySource,
} from './types.js';

export const STRATEGY_DECAY_LEDGER_EVENT_KIND = 'strategy.decay.decision' as const;
export const STRATEGY_DECAY_LEDGER_EVENT_SCHEMA = 'cosmos.engine.strategy-decay.ledger-event' as const;
export const STRATEGY_DECAY_LEDGER_EVENT_SCHEMA_VERSION = 1 as const;

interface LedgerEventRecord {
  readonly id: number;
  readonly ts: number;
  readonly kind: string;
  readonly symbol: string | null;
  readonly data: unknown;
}

type LedgerCasResult =
  | { readonly committed: true; readonly events: readonly LedgerEventRecord[] }
  | {
      readonly committed: false;
      readonly reason: 'VERSION_CONFLICT' | 'DEADLINE_EXCEEDED';
      readonly currentValue: string | null;
    };

/** Structural subset implemented by the sole existing Ledger owner. */
export interface StrategyDecayLedgerPort {
  getConfigValue(key: string): string | null;
  compareAndSetConfigValueAndLogEvents?(
    key: string,
    expectedValue: string | null,
    nextValue: string,
    records: readonly {
      readonly kind: string;
      readonly symbol?: string | null;
      readonly data?: unknown;
    }[],
    commitBeforeMs?: number,
  ): LedgerCasResult;
}

export type StrategyDecayHistoryLoad =
  | {
      readonly status: 'EMPTY';
      readonly serialized: null;
      readonly state: null;
      readonly reasonCode: null;
    }
  | {
      readonly status: 'AVAILABLE';
      readonly serialized: string;
      readonly state: Readonly<StrategyDecayHistoryState>;
      readonly reasonCode: null;
    }
  | {
      readonly status: 'MALFORMED' | 'UNAVAILABLE';
      readonly serialized: string | null;
      readonly state: null;
      readonly reasonCode: 'DECAY_HISTORY_MALFORMED' | 'DECAY_LEDGER_READ_FAILED';
    };

export type StrategyDecayHistoryCommit =
  | {
      readonly disposition: 'COMMITTED_NEW' | 'ALREADY_COMMITTED';
      readonly eventId: number | null;
      readonly state: Readonly<StrategyDecayHistoryState>;
    }
  | {
      readonly disposition: 'VERSION_CONFLICT' | 'DEADLINE_EXCEEDED' | 'INVALID_REQUEST' | 'PERSISTENCE_UNAVAILABLE';
      readonly eventId: null;
      readonly reasonCode: string;
      readonly current: StrategyDecayHistoryLoad;
    };

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
  return value as Record<string, unknown>;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

function decode(serialized: string): Readonly<StrategyDecayHistoryState> | null {
  try {
    const value = JSON.parse(serialized) as unknown;
    if (validateStrategyDecayHistoryState(value).length > 0) return null;
    return deepFreeze(value as StrategyDecayHistoryState);
  } catch {
    return null;
  }
}

function invalidCurrent(reasonCode: string): StrategyDecayHistoryLoad {
  return Object.freeze({
    status: 'UNAVAILABLE',
    serialized: null,
    state: null,
    reasonCode: reasonCode === 'DECAY_LEDGER_READ_FAILED'
      ? 'DECAY_LEDGER_READ_FAILED'
      : 'DECAY_LEDGER_READ_FAILED',
  });
}

export function strategyDecayConfigKey(strategy: StrategyDecaySource, direction: string): string {
  if (!(STRATEGY_DECAY_SOURCES as readonly unknown[]).includes(strategy)) {
    throw new TypeError('strategy decay config key requires BASIS or VOLUME');
  }
  if (typeof direction !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(direction)) {
    throw new TypeError('strategy decay config key requires a canonical direction');
  }
  const scope = stableHash128Hex(canonicalJson({ strategy, direction }));
  return `engine.strategy-decay.${strategy}.${scope}.v1`;
}

export function encodeStrategyDecayHistoryState(state: Readonly<StrategyDecayHistoryState>): string {
  const snapshot = snapshotStrategyDecayData(state);
  const issues = validateStrategyDecayHistoryState(snapshot);
  if (issues.length > 0) throw new TypeError(`strategy decay history is invalid: ${issues.join(',')}`);
  return canonicalJson(snapshot);
}

function validDecision(decision: unknown, state: StrategyDecayHistoryState): decision is StrategyDecayDecision {
  if (validateStrategyDecayDecision(decision).length > 0) return false;
  const value = decision as StrategyDecayDecision;
  if (value.revision !== state.revision
    || value.strategy !== state.strategy
    || value.configVersion !== state.configVersion
    || value.direction !== state.direction
    || value.policyId !== state.policyId
    || value.policyRevision !== state.policyRevision
    || value.reduceAfterConsecutiveDegradedWindows !== state.reduceAfterConsecutiveDegradedWindows
    || value.disableAfterConsecutiveDeadWindows !== state.disableAfterConsecutiveDeadWindows
    || value.retireAfterConsecutiveDeadWindows !== state.retireAfterConsecutiveDeadWindows
    || value.maximumRecentDecisions !== state.maximumRecentDecisions
    || value.evaluatedAtMs !== state.updatedAtMs
    || value.nextPosture !== state.effectivePosture
    || value.researchState !== state.researchState
    || value.researchCandidateId !== state.researchCandidateId) return false;
  const latest = state.recentDecisions.at(-1);
  return latest !== undefined
    && latest.decisionId === value.decisionId
    && latest.revision === value.revision
    && latest.measurementId === value.measurementId
    && latest.evaluatedAtMs === value.evaluatedAtMs
    && latest.measurementState === value.measurementState
    && latest.kind === value.kind
    && latest.nextPosture === value.nextPosture
    && latest.researchState === value.researchState
    && latest.researchCandidateId === value.researchCandidateId;
}

function targetPosture(kind: StrategyDecayDecisionKind): StrategyDecayPosture {
  if (kind === 'RETIRE') return 'RETIRED';
  if (kind === 'DISABLE') return 'DISABLED';
  if (kind === 'REDUCE') return 'REDUCED';
  return 'ENABLED';
}

function moreRestrictive(left: StrategyDecayPosture, right: StrategyDecayPosture): StrategyDecayPosture {
  return STRATEGY_DECAY_POSTURES.indexOf(left) >= STRATEGY_DECAY_POSTURES.indexOf(right) ? left : right;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function validTransition(
  expectedSerialized: string | null,
  nextState: StrategyDecayHistoryState,
  decision: StrategyDecayDecision,
): boolean {
  if (!validDecision(decision, nextState)) return false;
  const prior = expectedSerialized === null ? null : decode(expectedSerialized);
  if (expectedSerialized !== null && prior === null) return false;
  const previousPosture = prior?.effectivePosture ?? 'ENABLED';
  const previousResearchState = prior?.researchState ?? 'NONE';
  const previousCandidate = prior?.researchCandidateId ?? null;
  if (decision.priorPosture !== previousPosture
    || decision.revision !== (prior?.revision ?? 0) + 1
    || decision.evaluatedAtMs <= (prior?.updatedAtMs ?? -1)
    || (prior !== null && prior.recentDecisions.some((summary) => summary.measurementId === decision.measurementId))) {
    return false;
  }
  if (prior !== null && (prior.strategy !== decision.strategy || prior.direction !== decision.direction)) return false;

  const actionRequiresResearch = decision.kind === 'REDUCE'
    || decision.kind === 'DISABLE'
    || decision.kind === 'RETIRE';
  const expectedResearchState = previousResearchState === 'PENDING_REVIEW' || actionRequiresResearch
    ? 'PENDING_REVIEW'
    : 'NONE';
  const expectedCandidate = expectedResearchState === 'PENDING_REVIEW'
    ? previousCandidate ?? `decayresearch_${stableHash128Hex(canonicalJson({
        strategy: decision.strategy,
        configVersion: decision.configVersion,
        direction: decision.direction,
        firstMeasurementId: decision.measurementId,
        revision: decision.revision,
      }))}`
    : null;
  const expectedPosture = moreRestrictive(previousPosture, targetPosture(decision.kind));
  if (decision.nextPosture !== expectedPosture
    || decision.researchState !== expectedResearchState
    || decision.researchCandidateId !== expectedCandidate) return false;

  const measurementState = strategyDecayStateFromDecision(decision);
  if (measurementState === null) return false;
  const sameCohort = prior !== null
    && prior.configVersion === decision.configVersion
    && prior.direction === decision.direction
    && prior.policyRevision === decision.policyRevision;
  if (decision.reasonCodes.includes('COHORT_CHANGED_COUNTERS_RESET') !== (prior !== null && !sameCohort)) {
    return false;
  }
  let degradedWindows = sameCohort ? prior.consecutiveDegradedWindows : 0;
  let deadWindows = sameCohort ? prior.consecutiveDeadWindows : 0;
  if (measurementState === 'STABLE') {
    degradedWindows = 0;
    deadWindows = 0;
  } else if (measurementState === 'DEGRADED') {
    degradedWindows += 1;
    deadWindows = 0;
  } else if (measurementState === 'DEAD') {
    degradedWindows += 1;
    deadWindows += 1;
  }
  const expectedKind: StrategyDecayDecisionKind = measurementState === 'UNKNOWN'
    ? 'HOLD_UNKNOWN'
    : measurementState === 'STABLE'
      ? 'HOLD_STABLE'
      : measurementState === 'DEGRADED'
        ? (degradedWindows >= decision.reduceAfterConsecutiveDegradedWindows ? 'REDUCE' : 'HOLD_UNKNOWN')
        : deadWindows >= decision.retireAfterConsecutiveDeadWindows
          ? 'RETIRE'
          : deadWindows >= decision.disableAfterConsecutiveDeadWindows
            ? 'DISABLE'
            : 'REDUCE';
  if (decision.kind !== expectedKind || nextState.maximumRecentDecisions !== decision.maximumRecentDecisions) {
    return false;
  }
  if (prior !== null && prior.policyRevision === decision.policyRevision
    && nextState.maximumRecentDecisions !== prior.maximumRecentDecisions) return false;
  const expectedSummary = summarizeStrategyDecayDecision(
    decision,
    degradedWindows,
    deadWindows,
    nextState.maximumRecentDecisions,
    prior?.historyDigest ?? null,
  );
  const allSummaries = [...(prior?.recentDecisions ?? []), expectedSummary];
  const removed = allSummaries.slice(0, Math.max(0, allSummaries.length - nextState.maximumRecentDecisions));
  const expectedRecent = allSummaries.slice(-nextState.maximumRecentDecisions);
  const expectedCompactedHistoryDigest = removed.at(-1)?.historyDigest
    ?? prior?.compactedHistoryDigest
    ?? null;
  return nextState.strategy === decision.strategy
    && nextState.configVersion === decision.configVersion
    && nextState.direction === decision.direction
    && nextState.policyId === decision.policyId
    && nextState.policyRevision === decision.policyRevision
    && nextState.reduceAfterConsecutiveDegradedWindows === decision.reduceAfterConsecutiveDegradedWindows
    && nextState.disableAfterConsecutiveDeadWindows === decision.disableAfterConsecutiveDeadWindows
    && nextState.retireAfterConsecutiveDeadWindows === decision.retireAfterConsecutiveDeadWindows
    && nextState.revision === decision.revision
    && nextState.updatedAtMs === decision.evaluatedAtMs
    && nextState.effectivePosture === expectedPosture
    && nextState.researchState === expectedResearchState
    && nextState.researchCandidateId === expectedCandidate
    && nextState.consecutiveDegradedWindows === degradedWindows
    && nextState.consecutiveDeadWindows === deadWindows
    && nextState.totalDecisionCount === (prior?.totalDecisionCount ?? 0) + 1
    && nextState.compactedDecisionCount === nextState.totalDecisionCount - expectedRecent.length
    && nextState.compactedHistoryDigest === expectedCompactedHistoryDigest
    && nextState.historyDigest === expectedSummary.historyDigest
    && sameCanonical(nextState.recentDecisions, expectedRecent);
}

export class StrategyDecayLedgerAdapter {
  constructor(private readonly ledger: StrategyDecayLedgerPort) {}

  load(strategy: StrategyDecaySource, direction: string): StrategyDecayHistoryLoad {
    let serialized: string | null;
    try {
      serialized = this.ledger.getConfigValue(strategyDecayConfigKey(strategy, direction));
    } catch {
      return invalidCurrent('DECAY_LEDGER_READ_FAILED');
    }
    if (serialized === null) {
      return Object.freeze({ status: 'EMPTY', serialized: null, state: null, reasonCode: null });
    }
    if (typeof serialized !== 'string') {
      return Object.freeze({
        status: 'MALFORMED', serialized: null, state: null, reasonCode: 'DECAY_HISTORY_MALFORMED',
      });
    }
    const state = decode(serialized);
    if (state === null || state.strategy !== strategy || state.direction !== direction) {
      return Object.freeze({
        status: 'MALFORMED', serialized, state: null, reasonCode: 'DECAY_HISTORY_MALFORMED',
      });
    }
    return Object.freeze({ status: 'AVAILABLE', serialized, state, reasonCode: null });
  }

  commit(input: {
    readonly expectedSerialized: string | null;
    readonly decision: Readonly<StrategyDecayDecision>;
    readonly nextState: Readonly<StrategyDecayHistoryState>;
    readonly commitBeforeMs?: number;
  }): StrategyDecayHistoryCommit {
    const snapshot = snapshotStrategyDecayData(input);
    const exact = exactRecord(snapshot, ['expectedSerialized', 'decision', 'nextState'])
      ?? exactRecord(snapshot, ['expectedSerialized', 'decision', 'nextState', 'commitBeforeMs']);
    const fallbackCurrent = invalidCurrent('DECAY_LEDGER_READ_FAILED');
    if (exact === null || (exact.expectedSerialized !== null && typeof exact.expectedSerialized !== 'string')) {
      return Object.freeze({
        disposition: 'INVALID_REQUEST', eventId: null, reasonCode: 'DECAY_COMMIT_SHAPE_INVALID', current: fallbackCurrent,
      });
    }
    const nextState = exact.nextState as StrategyDecayHistoryState;
    const decision = exact.decision as StrategyDecayDecision;
    if (validateStrategyDecayHistoryState(nextState).length > 0
      || !validTransition(exact.expectedSerialized as string | null, nextState, decision)) {
      return Object.freeze({
        disposition: 'INVALID_REQUEST', eventId: null, reasonCode: 'DECAY_COMMIT_TRANSITION_INVALID', current: fallbackCurrent,
      });
    }
    if (exact.commitBeforeMs !== undefined
      && (!Number.isSafeInteger(exact.commitBeforeMs) || Number(exact.commitBeforeMs) < 0
        || Object.is(exact.commitBeforeMs, -0))) {
      return Object.freeze({
        disposition: 'INVALID_REQUEST', eventId: null, reasonCode: 'DECAY_COMMIT_DEADLINE_INVALID', current: fallbackCurrent,
      });
    }
    if (typeof this.ledger.compareAndSetConfigValueAndLogEvents !== 'function') {
      return Object.freeze({
        disposition: 'PERSISTENCE_UNAVAILABLE', eventId: null, reasonCode: 'DECAY_LEDGER_CAS_UNAVAILABLE', current: fallbackCurrent,
      });
    }
    let nextValue: string;
    try {
      nextValue = encodeStrategyDecayHistoryState(nextState);
    } catch {
      return Object.freeze({
        disposition: 'INVALID_REQUEST', eventId: null, reasonCode: 'DECAY_COMMIT_STATE_INVALID', current: fallbackCurrent,
      });
    }
    let result: LedgerCasResult;
    try {
      result = this.ledger.compareAndSetConfigValueAndLogEvents(
        strategyDecayConfigKey(nextState.strategy, nextState.direction),
        exact.expectedSerialized as string | null,
        nextValue,
        Object.freeze([Object.freeze({
          kind: STRATEGY_DECAY_LEDGER_EVENT_KIND,
          symbol: nextState.strategy,
          data: deepFreeze({
            schema: STRATEGY_DECAY_LEDGER_EVENT_SCHEMA,
            schemaVersion: STRATEGY_DECAY_LEDGER_EVENT_SCHEMA_VERSION,
            decision,
            stateRevision: nextState.revision,
            historyDigest: nextState.historyDigest,
          }),
        })]),
        exact.commitBeforeMs as number | undefined,
      );
    } catch {
      return Object.freeze({
        disposition: 'PERSISTENCE_UNAVAILABLE', eventId: null, reasonCode: 'DECAY_LEDGER_COMMIT_FAILED', current: fallbackCurrent,
      });
    }
    if (result.committed) {
      const event = result.events[0];
      if (!event || !Number.isSafeInteger(event.id) || event.id < 1) {
        return Object.freeze({
          disposition: 'PERSISTENCE_UNAVAILABLE', eventId: null, reasonCode: 'DECAY_LEDGER_COMMIT_READBACK_INVALID', current: fallbackCurrent,
        });
      }
      return Object.freeze({ disposition: 'COMMITTED_NEW', eventId: event.id, state: deepFreeze(nextState) });
    }
    const current = this.load(nextState.strategy, nextState.direction);
    if (result.reason === 'VERSION_CONFLICT'
      && current.status === 'AVAILABLE'
      && current.serialized === nextValue
      && current.state.historyDigest === nextState.historyDigest) {
      return Object.freeze({ disposition: 'ALREADY_COMMITTED', eventId: null, state: current.state });
    }
    return Object.freeze({
      disposition: result.reason,
      eventId: null,
      reasonCode: result.reason === 'VERSION_CONFLICT' ? 'DECAY_LEDGER_VERSION_CONFLICT' : 'DECAY_LEDGER_DEADLINE_EXCEEDED',
      current,
    });
  }
}
