import {
  canonicalJson,
  stableHash128Hex,
} from '../../foundation/contracts/index.js';
import {
  validateStrategyDecayDecision,
  validateStrategyDecayHistoryState,
} from './governance.js';
import {
  STRATEGY_DECAY_SOURCES,
  type StrategyDecayDecision,
  type StrategyDecayHistoryState,
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
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
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

export function strategyDecayConfigKey(strategy: StrategyDecaySource): string {
  if (!(STRATEGY_DECAY_SOURCES as readonly unknown[]).includes(strategy)) {
    throw new TypeError('strategy decay config key requires BASIS or VOLUME');
  }
  return `engine.strategy-decay.${strategy}.v1`;
}

export function encodeStrategyDecayHistoryState(state: Readonly<StrategyDecayHistoryState>): string {
  const issues = validateStrategyDecayHistoryState(state);
  if (issues.length > 0) throw new TypeError(`strategy decay history is invalid: ${issues.join(',')}`);
  return canonicalJson(state);
}

function validDecision(decision: unknown, state: StrategyDecayHistoryState): decision is StrategyDecayDecision {
  if (validateStrategyDecayDecision(decision).length > 0) return false;
  const value = decision as StrategyDecayDecision;
  if (value.revision !== state.revision
    || value.strategy !== state.strategy
    || value.configVersion !== state.configVersion
    || value.policyRevision !== state.policyRevision
    || value.nextPosture !== state.effectivePosture
    || value.researchState !== state.researchState
    || value.researchCandidateId !== state.researchCandidateId) return false;
  const latest = state.recentDecisions.at(-1);
  return latest !== undefined
    && latest.decisionId === value.decisionId
    && latest.revision === value.revision
    && latest.measurementId === value.measurementId
    && latest.kind === value.kind;
}

function validTransition(
  expectedSerialized: string | null,
  nextState: StrategyDecayHistoryState,
  decision: StrategyDecayDecision,
): boolean {
  if (!validDecision(decision, nextState)) return false;
  const prior = expectedSerialized === null ? null : decode(expectedSerialized);
  if (expectedSerialized !== null && prior === null) return false;
  const expectedDigest = `decayhist_${stableHash128Hex(canonicalJson({
    previousHistoryDigest: prior?.historyDigest ?? null,
    decisionId: decision.decisionId,
    revision: decision.revision,
  }))}`;
  if (prior === null) {
    return nextState.revision === 1
      && nextState.totalDecisionCount === 1
      && nextState.historyDigest === expectedDigest;
  }
  return prior.strategy === nextState.strategy
    && prior.revision + 1 === nextState.revision
    && prior.totalDecisionCount + 1 === nextState.totalDecisionCount
    && nextState.historyDigest === expectedDigest;
}

export class StrategyDecayLedgerAdapter {
  constructor(private readonly ledger: StrategyDecayLedgerPort) {}

  load(strategy: StrategyDecaySource): StrategyDecayHistoryLoad {
    let serialized: string | null;
    try {
      serialized = this.ledger.getConfigValue(strategyDecayConfigKey(strategy));
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
    if (state === null || state.strategy !== strategy) {
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
    const exact = exactRecord(
      input,
      input && Object.prototype.hasOwnProperty.call(input, 'commitBeforeMs')
        ? ['expectedSerialized', 'decision', 'nextState', 'commitBeforeMs']
        : ['expectedSerialized', 'decision', 'nextState'],
    );
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
      && (!Number.isSafeInteger(exact.commitBeforeMs) || Number(exact.commitBeforeMs) < 0)) {
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
        strategyDecayConfigKey(nextState.strategy),
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
    const current = this.load(nextState.strategy);
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
