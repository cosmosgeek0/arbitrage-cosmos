import { isProxy } from 'node:util/types';

import { isValidUtcMillis } from '../../foundation/contracts/index.js';
import {
  capitalDigest,
  deriveCapitalConfigRevision,
} from '../contracts/index.js';
import type {
  AllocationCandidate,
  StrategyDecayAllocationPosture,
} from './types.js';

const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const DECISION_ID = /^decaydec_[a-f0-9]{32}$/;
const MEASUREMENT_ID = /^decaymeas_[a-f0-9]{32}$/;
const POLICY_REVISION = /^decaypolicy_[a-f0-9]{32}$/;
const HISTORY_DIGEST = /^decayhist_[a-f0-9]{32}$/;
const MAX_POSTURES = 64;
const MAX_SNAPSHOT_DEPTH = 4;
const MAX_SNAPSHOT_NODES = 1_000;
const MAX_SNAPSHOT_STRING_LENGTH = 4_096;

const STRATEGY_DECAY_GATE_POLICY_SEMANTICS = Object.freeze({
  reducedFraction: '1/2',
  freshness: 'EXCLUSIVE_VALID_UNTIL',
  unknownMeasurementDisposition: 'BLOCK',
});

export const STRATEGY_DECAY_ALLOCATION_GATE_POLICY_REVISION = deriveCapitalConfigRevision(
  'strategy-decay-allocation-gate',
  STRATEGY_DECAY_GATE_POLICY_SEMANTICS,
);

/** Trap-zero bounded snapshot for the complete optional Capital gate input. */
export function snapshotStrategyDecayPostureData(value: unknown): unknown | null {
  try {
    const active = new Set<object>();
    let nodes = 0;
    const visit = (candidate: unknown, depth: number): unknown => {
      nodes += 1;
      if (nodes > MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) throw new RangeError('posture graph overbound');
      if (candidate === null || typeof candidate === 'boolean') return candidate;
      if (typeof candidate === 'number') {
        if (!Number.isFinite(candidate) || Object.is(candidate, -0)) throw new TypeError('posture number invalid');
        return candidate;
      }
      if (typeof candidate === 'string') {
        if (candidate.length > MAX_SNAPSHOT_STRING_LENGTH) throw new RangeError('posture string overbound');
        return candidate;
      }
      if ((typeof candidate !== 'object' && typeof candidate !== 'function')
        || isProxy(candidate)
        || typeof candidate === 'function'
        || active.has(candidate)) {
        throw new TypeError('posture input must be ordinary acyclic data');
      }
      active.add(candidate);
      const prototype = Object.getPrototypeOf(candidate);
      if (Array.isArray(candidate)) {
        if (prototype !== Array.prototype) throw new TypeError('posture array prototype invalid');
        const lengthDescriptor = Object.getOwnPropertyDescriptor(candidate, 'length');
        if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, 'value')
          || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0
          || lengthDescriptor.value > MAX_POSTURES) throw new RangeError('posture array length invalid');
        const length = lengthDescriptor.value as number;
        const own = Reflect.ownKeys(candidate);
        if (own.length !== length + 1 || own.some((key) => typeof key !== 'string'
          || (key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)))) {
          throw new TypeError('posture array must be dense own data');
        }
        const output: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
          if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError('posture array slot invalid');
          }
          output.push(visit(descriptor.value, depth + 1));
        }
        active.delete(candidate);
        return Object.freeze(output);
      }
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('posture record prototype invalid');
      const own = Reflect.ownKeys(candidate);
      if (own.length > POSTURE_KEYS.length
        || own.some((key) => typeof key !== 'string' || key.length > 256)) {
        throw new TypeError('posture record keys invalid');
      }
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of own as string[]) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('posture record field invalid');
        }
        output[key] = visit(descriptor.value, depth + 1);
      }
      active.delete(candidate);
      return Object.freeze(output);
    };
    return visit(value, 0);
  } catch {
    return null;
  }
}

function semantics(posture: Omit<StrategyDecayAllocationPosture, 'projectionRevision'>): unknown {
  return Object.freeze({
    strategy: posture.strategy,
    configVersion: posture.configVersion,
    direction: posture.direction,
    effectivePosture: posture.effectivePosture,
    latestMeasurementState: posture.latestMeasurementState,
    decisionId: posture.decisionId,
    measurementId: posture.measurementId,
    policyRevision: posture.policyRevision,
    historyRevision: posture.historyRevision,
    evaluatedAtMs: posture.evaluatedAtMs,
    validUntilMs: posture.validUntilMs,
    historyDigest: posture.historyDigest,
  });
}

export function deriveStrategyDecayAllocationPostureRevision(
  posture: Omit<StrategyDecayAllocationPosture, 'projectionRevision'>,
): string {
  const snapshot = snapshotStrategyDecayPostureData(posture);
  if (!exactKeys(snapshot, POSTURE_SEMANTIC_KEYS)) throw new TypeError('strategy decay posture material invalid');
  return deriveCapitalConfigRevision(
    'strategy-decay-allocation-posture',
    semantics(snapshot as unknown as Omit<StrategyDecayAllocationPosture, 'projectionRevision'>),
  );
}

/** Capital owns the final content revision over the narrow Engine projection. */
export function createStrategyDecayAllocationPosture(
  source: Omit<StrategyDecayAllocationPosture, 'projectionRevision'>,
): Readonly<StrategyDecayAllocationPosture> {
  const snapshot = snapshotStrategyDecayPostureData(source);
  if (!exactKeys(snapshot, POSTURE_SEMANTIC_KEYS)) throw new TypeError('strategy decay posture source invalid');
  const material = snapshot as unknown as Omit<StrategyDecayAllocationPosture, 'projectionRevision'>;
  const posture = Object.freeze({
    ...material,
    projectionRevision: deriveStrategyDecayAllocationPostureRevision(material),
  });
  const issues = validateStrategyDecayAllocationPosture(posture);
  if (issues.length > 0) throw new TypeError(`strategy decay posture source invalid: ${issues.join(',')}`);
  return posture;
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

const POSTURE_KEYS = Object.freeze([
  'strategy', 'configVersion', 'direction', 'effectivePosture', 'latestMeasurementState',
  'decisionId', 'measurementId', 'policyRevision', 'historyRevision', 'evaluatedAtMs',
  'validUntilMs', 'historyDigest', 'projectionRevision',
] as const);
const POSTURE_SEMANTIC_KEYS = Object.freeze(POSTURE_KEYS.filter((key) => key !== 'projectionRevision'));

function validateSnapshotPosture(value: unknown): readonly string[] {
  const reasons: string[] = [];
  if (!exactKeys(value, POSTURE_KEYS)) return Object.freeze(['STRATEGY_DECAY_POSTURE_SHAPE_INVALID']);
  if (value.strategy !== 'BASIS' && value.strategy !== 'VOLUME') reasons.push('STRATEGY_DECAY_POSTURE_STRATEGY_INVALID');
  if (typeof value.configVersion !== 'string' || !LABEL.test(value.configVersion)) reasons.push('STRATEGY_DECAY_POSTURE_CONFIG_INVALID');
  if (typeof value.direction !== 'string' || !LABEL.test(value.direction)) reasons.push('STRATEGY_DECAY_POSTURE_DIRECTION_INVALID');
  if (!['ENABLED', 'REDUCED', 'DISABLED', 'RETIRED'].includes(String(value.effectivePosture))) {
    reasons.push('STRATEGY_DECAY_POSTURE_VALUE_INVALID');
  }
  if (!['UNKNOWN', 'STABLE', 'DEGRADED', 'DEAD'].includes(String(value.latestMeasurementState))) {
    reasons.push('STRATEGY_DECAY_POSTURE_MEASUREMENT_STATE_INVALID');
  }
  if (typeof value.decisionId !== 'string' || !DECISION_ID.test(value.decisionId)) reasons.push('STRATEGY_DECAY_POSTURE_DECISION_INVALID');
  if (typeof value.measurementId !== 'string' || !MEASUREMENT_ID.test(value.measurementId)) reasons.push('STRATEGY_DECAY_POSTURE_MEASUREMENT_INVALID');
  if (typeof value.policyRevision !== 'string' || !POLICY_REVISION.test(value.policyRevision)) reasons.push('STRATEGY_DECAY_POSTURE_POLICY_INVALID');
  if (!Number.isSafeInteger(value.historyRevision) || Number(value.historyRevision) <= 0 || Object.is(value.historyRevision, -0)) {
    reasons.push('STRATEGY_DECAY_POSTURE_HISTORY_REVISION_INVALID');
  }
  if (!isValidUtcMillis(value.evaluatedAtMs)) reasons.push('STRATEGY_DECAY_POSTURE_EVALUATED_AT_INVALID');
  if (!isValidUtcMillis(value.validUntilMs)
    || (isValidUtcMillis(value.evaluatedAtMs) && Number(value.validUntilMs) <= Number(value.evaluatedAtMs))) {
    reasons.push('STRATEGY_DECAY_POSTURE_VALID_UNTIL_INVALID');
  }
  if (typeof value.historyDigest !== 'string' || !HISTORY_DIGEST.test(value.historyDigest)) reasons.push('STRATEGY_DECAY_POSTURE_HISTORY_INVALID');
  if (reasons.length === 0) {
    try {
      const material: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of POSTURE_SEMANTIC_KEYS) material[key] = value[key];
      if (value.projectionRevision !== deriveStrategyDecayAllocationPostureRevision(
        material as unknown as Omit<StrategyDecayAllocationPosture, 'projectionRevision'>,
      )) {
        reasons.push('STRATEGY_DECAY_POSTURE_REVISION_MISMATCH');
      }
    } catch {
      reasons.push('STRATEGY_DECAY_POSTURE_REVISION_MISMATCH');
    }
  }
  return Object.freeze([...new Set(reasons)].sort());
}

export function validateStrategyDecayAllocationPosture(value: unknown): readonly string[] {
  const snapshot = snapshotStrategyDecayPostureData(value);
  return snapshot === null
    ? Object.freeze(['STRATEGY_DECAY_POSTURE_SHAPE_INVALID'])
    : validateSnapshotPosture(snapshot);
}

function laneKey(posture: Readonly<StrategyDecayAllocationPosture>): string {
  return `${posture.strategy}\u0000${posture.configVersion}\u0000${posture.direction}`;
}

function compareText(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validateSnapshotPostureSet(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_POSTURES) {
    return Object.freeze(['STRATEGY_DECAY_POSTURE_SET_INVALID']);
  }
  const reasons = value.flatMap((posture) => validateSnapshotPosture(posture));
  const valid = value.filter((posture): posture is StrategyDecayAllocationPosture => (
    validateSnapshotPosture(posture).length === 0
  ));
  const keys = valid.map(laneKey);
  if (new Set(keys).size !== keys.length) reasons.push('STRATEGY_DECAY_POSTURE_LANE_DUPLICATE');
  return Object.freeze([...new Set(reasons)].sort());
}

export function validateStrategyDecayPostureSet(value: unknown): readonly string[] {
  const snapshot = snapshotStrategyDecayPostureData(value);
  return snapshot === null
    ? Object.freeze(['STRATEGY_DECAY_POSTURE_SET_INVALID'])
    : validateSnapshotPostureSet(snapshot);
}

export function strategyDecayPostureSetDigest(
  postures: readonly Readonly<StrategyDecayAllocationPosture>[],
): string {
  const snapshot = snapshotStrategyDecayPostureData(postures);
  if (!Array.isArray(snapshot) || validateSnapshotPostureSet(snapshot).length > 0) {
    throw new TypeError('strategy decay posture set invalid');
  }
  const ordered = [...snapshot as unknown as readonly StrategyDecayAllocationPosture[]]
    .sort((left, right) => compareText(laneKey(left), laneKey(right)));
  return capitalDigest(ordered);
}

export interface StrategyDecayGateAssessment {
  readonly configured: boolean;
  readonly posture: Readonly<StrategyDecayAllocationPosture> | null;
  readonly reasonCodes: readonly string[];
}

export function assessStrategyDecayAllocationGate(
  postures: readonly Readonly<StrategyDecayAllocationPosture>[] | undefined,
  candidate: Readonly<AllocationCandidate>,
  nowMs: number,
): Readonly<StrategyDecayGateAssessment> {
  if (postures === undefined) {
    return Object.freeze({ configured: false, posture: null, reasonCodes: Object.freeze([]) });
  }
  const snapshot = snapshotStrategyDecayPostureData(postures);
  if (!Array.isArray(snapshot)) {
    return Object.freeze({
      configured: true, posture: null,
      reasonCodes: Object.freeze(['STRATEGY_DECAY_POSTURE_SET_INVALID']),
    });
  }
  const canonicalPostures = snapshot as unknown as readonly StrategyDecayAllocationPosture[];
  const setIssues = validateSnapshotPostureSet(canonicalPostures);
  if (setIssues.length > 0) return Object.freeze({ configured: true, posture: null, reasonCodes: setIssues });
  if (!isValidUtcMillis(nowMs) || Object.is(nowMs, -0)) {
    return Object.freeze({
      configured: true, posture: null,
      reasonCodes: Object.freeze(['STRATEGY_DECAY_NOW_INVALID']),
    });
  }
  const proposal = candidate.consideration.proposal;
  if (proposal.sourceConfigRevision === null) {
    return Object.freeze({
      configured: true, posture: null,
      reasonCodes: Object.freeze(['STRATEGY_DECAY_CANDIDATE_CONFIG_UNKNOWN']),
    });
  }
  const exact = canonicalPostures.find((posture) => posture.strategy === proposal.strategy
    && posture.configVersion === proposal.sourceConfigRevision
    && posture.direction === proposal.direction) ?? null;
  if (exact === null) {
    const sameConfig = canonicalPostures.some((posture) => posture.strategy === proposal.strategy
      && posture.configVersion === proposal.sourceConfigRevision);
    const sameDirection = canonicalPostures.some((posture) => posture.strategy === proposal.strategy
      && posture.direction === proposal.direction);
    return Object.freeze({
      configured: true, posture: null,
      reasonCodes: Object.freeze([sameConfig
        ? 'STRATEGY_DECAY_DIRECTION_MISMATCH'
        : sameDirection ? 'STRATEGY_DECAY_CONFIG_MISMATCH' : 'STRATEGY_DECAY_POSTURE_MISSING']),
    });
  }
  const reasons: string[] = [];
  if (!isValidUtcMillis(nowMs) || exact.evaluatedAtMs > nowMs || nowMs >= exact.validUntilMs) {
    reasons.push('STRATEGY_DECAY_POSTURE_STALE');
  }
  if (exact.latestMeasurementState === 'UNKNOWN') reasons.push('STRATEGY_DECAY_EVIDENCE_UNKNOWN');
  if (exact.effectivePosture === 'DISABLED') reasons.push('STRATEGY_DECAY_DISABLED');
  if (exact.effectivePosture === 'RETIRED') reasons.push('STRATEGY_DECAY_RETIRED');
  return Object.freeze({ configured: true, posture: exact, reasonCodes: Object.freeze(reasons.sort()) });
}
