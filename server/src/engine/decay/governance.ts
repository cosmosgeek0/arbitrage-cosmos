import { types as utilTypes } from 'node:util';

import {
  canonicalJson,
  isValidUtcMillis,
  stableHash128Hex,
} from '../../foundation/contracts/index.js';
import {
  STRATEGY_DECAY_AXES,
  STRATEGY_DECAY_DECISION_KINDS,
  STRATEGY_DECAY_DECISION_SCHEMA,
  STRATEGY_DECAY_DECISION_SCHEMA_VERSION,
  STRATEGY_DECAY_EVIDENCE_AUTHORITIES,
  STRATEGY_DECAY_HISTORY_SCHEMA,
  STRATEGY_DECAY_HISTORY_SCHEMA_VERSION,
  STRATEGY_DECAY_MEASUREMENT_SCHEMA,
  STRATEGY_DECAY_MEASUREMENT_SCHEMA_VERSION,
  STRATEGY_DECAY_POSTURES,
  STRATEGY_DECAY_RESEARCH_STATES,
  STRATEGY_DECAY_SOURCES,
  STRATEGY_DECAY_STATES,
  type StrategyDecayAxisAssessment,
  type StrategyDecayDecision,
  type StrategyDecayDecisionKind,
  type StrategyDecayDecisionSummary,
  type StrategyDecayEvaluationResult,
  type StrategyDecayGovernancePolicy,
  type StrategyDecayHistoryState,
  type StrategyDecayMeasurement,
  type StrategyDecayPosture,
  type StrategyDecayResearchState,
  type StrategyDecayState,
} from './types.js';

const MAX_RECENT_DECISIONS = 64;
const MAX_SNAPSHOT_ARRAY_LENGTH = 20_000;
const MAX_SNAPSHOT_DEPTH = 16;
const MAX_SNAPSHOT_NODES = 150_000;
const MAX_SNAPSHOT_OBJECT_KEYS = 4_096;
const MAX_SNAPSHOT_STRING_LENGTH = 1_048_576;
const MAX_SNAPSHOT_STRING_UNITS = 16 * 1_048_576;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_.:-]{0,127}$/;
const DECISION_ID = /^decaydec_[a-f0-9]{32}$/;
const MEASUREMENT_ID = /^decaymeas_[a-f0-9]{32}$/;
const RESEARCH_ID = /^decayresearch_[a-f0-9]{32}$/;
const HISTORY_DIGEST = /^decayhist_[a-f0-9]{32}$/;
const POLICY_REVISION = /^decaypolicy_[a-f0-9]{32}$/;

const POLICY_KEYS = Object.freeze([
  'policyId',
  'policyRevision',
  'reduceAfterConsecutiveDegradedWindows',
  'disableAfterConsecutiveDeadWindows',
  'retireAfterConsecutiveDeadWindows',
  'maximumRecentDecisions',
] as const);
const POLICY_SEMANTIC_KEYS = Object.freeze(POLICY_KEYS.filter((key) => key !== 'policyRevision'));
const MEASUREMENT_KEYS = Object.freeze([
  'schema', 'schemaVersion', 'measurementId', 'strategy', 'configVersion', 'direction',
  'evaluatedAtMs', 'evidenceAuthority', 'baselineWindow', 'currentWindow', 'axes',
  'state', 'reasonCodes',
] as const);
const WINDOW_KEYS = Object.freeze(['startAtMs', 'endAtMs'] as const);
const AXIS_KEYS = Object.freeze([
  'axis', 'state', 'baselineSampleCount', 'currentSampleCount', 'baselineValue',
  'currentValue', 'unit', 'reasonCodes', 'evidenceIds',
] as const);
const STATE_KEYS = Object.freeze([
  'schema', 'schemaVersion', 'strategy', 'configVersion', 'direction', 'policyId', 'policyRevision',
  'reduceAfterConsecutiveDegradedWindows', 'disableAfterConsecutiveDeadWindows',
  'retireAfterConsecutiveDeadWindows', 'revision',
  'updatedAtMs', 'effectivePosture', 'researchState', 'researchCandidateId',
  'consecutiveDegradedWindows', 'consecutiveDeadWindows', 'totalDecisionCount',
  'compactedDecisionCount', 'maximumRecentDecisions', 'compactedHistoryDigest',
  'recentDecisions', 'historyDigest',
] as const);
const SUMMARY_KEYS = Object.freeze([
  'decisionId', 'revision', 'strategy', 'configVersion', 'direction', 'policyId', 'policyRevision',
  'reduceAfterConsecutiveDegradedWindows', 'disableAfterConsecutiveDeadWindows',
  'retireAfterConsecutiveDeadWindows',
  'measurementId', 'evaluatedAtMs', 'measurementState', 'kind', 'nextPosture', 'researchState',
  'researchCandidateId', 'consecutiveDegradedWindows', 'consecutiveDeadWindows',
  'maximumRecentDecisions', 'historyDigest',
] as const);
const DECISION_KEYS = Object.freeze([
  'schema', 'schemaVersion', 'decisionId', 'revision', 'strategy', 'configVersion',
  'direction', 'policyId', 'policyRevision', 'reduceAfterConsecutiveDegradedWindows',
  'disableAfterConsecutiveDeadWindows', 'retireAfterConsecutiveDeadWindows',
  'maximumRecentDecisions', 'measurementId', 'evaluatedAtMs', 'measurementState', 'kind', 'priorPosture',
  'nextPosture', 'researchState', 'researchCandidateId', 'reasonCodes',
  'automaticResearchPromotion', 'executionAuthority',
] as const);

/**
 * Takes one bounded, trap-zero snapshot of an ordinary JSON-like data graph.
 * Proxy identity is rejected before any reflective operation, including for
 * revoked and forwarding Proxies. Arrays are length-bounded from their own
 * data descriptor before key enumeration or element materialization.
 */
export function snapshotStrategyDecayData(value: unknown): unknown | null {
  try {
    const active = new Set<object>();
    const budget = { nodes: 0, stringUnits: 0 };
    const visit = (candidate: unknown, depth: number): unknown => {
      budget.nodes += 1;
      if (budget.nodes > MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) {
        throw new RangeError('strategy decay input graph exceeds its bound');
      }
      if (candidate === null || typeof candidate === 'boolean') return candidate;
      if (typeof candidate === 'number') {
        if (!Number.isFinite(candidate) || Object.is(candidate, -0)) {
          throw new TypeError('strategy decay numbers must be finite canonical values');
        }
        return candidate;
      }
      if (typeof candidate === 'string') {
        if (candidate.length > MAX_SNAPSHOT_STRING_LENGTH) {
          throw new RangeError('strategy decay input string exceeds its bound');
        }
        budget.stringUnits += candidate.length;
        if (budget.stringUnits > MAX_SNAPSHOT_STRING_UNITS) {
          throw new RangeError('strategy decay input strings exceed their aggregate bound');
        }
        return candidate;
      }
      if ((typeof candidate !== 'object' && typeof candidate !== 'function')
        || utilTypes.isProxy(candidate)) {
        throw new TypeError('strategy decay input must be ordinary data');
      }
      if (typeof candidate === 'function' || active.has(candidate)) {
        throw new TypeError('strategy decay input cannot contain functions or cycles');
      }
      active.add(candidate);
      const prototype = Object.getPrototypeOf(candidate);
      if (Array.isArray(candidate)) {
        if (prototype !== Array.prototype) throw new TypeError('strategy decay array prototype invalid');
        const lengthDescriptor = Object.getOwnPropertyDescriptor(candidate, 'length');
        if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, 'value')
          || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0
          || lengthDescriptor.value > MAX_SNAPSHOT_ARRAY_LENGTH) {
          throw new RangeError('strategy decay array length invalid or overbound');
        }
        const length = lengthDescriptor.value as number;
        const ownKeys = Reflect.ownKeys(candidate);
        if (ownKeys.length !== length + 1 || ownKeys.some((key) => typeof key !== 'string'
          || (key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)))) {
          throw new TypeError('strategy decay arrays must be dense own data without named fields');
        }
        const output: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
          if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError('strategy decay array element must be enumerable own data');
          }
          output.push(visit(descriptor.value, depth + 1));
        }
        active.delete(candidate);
        return Object.freeze(output);
      }
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('strategy decay record prototype invalid');
      }
      const ownKeys = Reflect.ownKeys(candidate);
      if (ownKeys.length > MAX_SNAPSHOT_OBJECT_KEYS
        || ownKeys.some((key) => typeof key !== 'string' || key.length > 256)) {
        throw new RangeError('strategy decay record keys invalid or overbound');
      }
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of ownKeys as string[]) {
        budget.stringUnits += key.length;
        if (budget.stringUnits > MAX_SNAPSHOT_STRING_UNITS) {
          throw new RangeError('strategy decay input strings exceed their aggregate bound');
        }
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('strategy decay record fields must be enumerable own data');
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

function recordWithExactKeys(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return null;
  return value as Record<string, unknown>;
}

function denseArray(value: unknown, maximum: number): readonly unknown[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  return value;
}

function sortedUniqueStrings(
  value: unknown,
  maximum: number,
  pattern: RegExp,
): value is readonly string[] {
  const array = denseArray(value, maximum);
  if (array === null || array.some((entry) => typeof entry !== 'string' || !pattern.test(entry))) return false;
  const strings = array as readonly string[];
  return strings.every((entry, index) => index === 0 || strings[index - 1] < entry);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}

function label(value: unknown): value is string {
  return typeof value === 'string' && LABEL.test(value);
}

function validateEmbeddedGovernancePolicy(
  value: Record<string, unknown>,
  prefix: string,
  issues: string[],
): void {
  if (!label(value.policyId)) issues.push(`${prefix}_POLICY_ID_INVALID`);
  if (typeof value.policyRevision !== 'string' || !POLICY_REVISION.test(value.policyRevision)) {
    issues.push(`${prefix}_POLICY_REVISION_INVALID`);
  }
  if (value.reduceAfterConsecutiveDegradedWindows !== 1) {
    issues.push(`${prefix}_REDUCE_THRESHOLD_INVALID`);
  }
  if (!positiveSafeInteger(value.disableAfterConsecutiveDeadWindows)) {
    issues.push(`${prefix}_DISABLE_THRESHOLD_INVALID`);
  }
  if (!positiveSafeInteger(value.retireAfterConsecutiveDeadWindows)) {
    issues.push(`${prefix}_RETIRE_THRESHOLD_INVALID`);
  }
  if (!positiveSafeInteger(value.maximumRecentDecisions)
    || value.maximumRecentDecisions > MAX_RECENT_DECISIONS) {
    issues.push(`${prefix}_RETENTION_BOUND_INVALID`);
  }
  if (positiveSafeInteger(value.disableAfterConsecutiveDeadWindows)
    && positiveSafeInteger(value.retireAfterConsecutiveDeadWindows)
    && value.disableAfterConsecutiveDeadWindows >= value.retireAfterConsecutiveDeadWindows) {
    issues.push(`${prefix}_RETIRE_THRESHOLD_ORDER_INVALID`);
  }
  if (label(value.policyId)
    && value.reduceAfterConsecutiveDegradedWindows === 1
    && positiveSafeInteger(value.disableAfterConsecutiveDeadWindows)
    && positiveSafeInteger(value.retireAfterConsecutiveDeadWindows)
    && positiveSafeInteger(value.maximumRecentDecisions)) {
    try {
      const expected = deriveStrategyDecayPolicyRevision({
        policyId: value.policyId,
        reduceAfterConsecutiveDegradedWindows: value.reduceAfterConsecutiveDegradedWindows,
        disableAfterConsecutiveDeadWindows: value.disableAfterConsecutiveDeadWindows,
        retireAfterConsecutiveDeadWindows: value.retireAfterConsecutiveDeadWindows,
        maximumRecentDecisions: value.maximumRecentDecisions,
      });
      if (value.policyRevision !== expected) issues.push(`${prefix}_POLICY_REVISION_CONTENT_MISMATCH`);
    } catch {
      issues.push(`${prefix}_POLICY_REVISION_CONTENT_MISMATCH`);
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function policySemantics(policy: Omit<StrategyDecayGovernancePolicy, 'policyRevision'>): unknown {
  return {
    policyId: policy.policyId,
    reduceAfterConsecutiveDegradedWindows: policy.reduceAfterConsecutiveDegradedWindows,
    disableAfterConsecutiveDeadWindows: policy.disableAfterConsecutiveDeadWindows,
    retireAfterConsecutiveDeadWindows: policy.retireAfterConsecutiveDeadWindows,
    maximumRecentDecisions: policy.maximumRecentDecisions,
  };
}

export function deriveStrategyDecayPolicyRevision(
  policy: Omit<StrategyDecayGovernancePolicy, 'policyRevision'>,
): string {
  const snapshot = snapshotStrategyDecayData(policy);
  const exact = recordWithExactKeys(snapshot, POLICY_SEMANTIC_KEYS);
  if (exact === null
    || !label(exact.policyId)
    || exact.reduceAfterConsecutiveDegradedWindows !== 1
    || !positiveSafeInteger(exact.disableAfterConsecutiveDeadWindows)
    || !positiveSafeInteger(exact.retireAfterConsecutiveDeadWindows)
    || !positiveSafeInteger(exact.maximumRecentDecisions)) {
    throw new TypeError('strategy decay policy semantics invalid');
  }
  return `decaypolicy_${stableHash128Hex(canonicalJson(policySemantics(
    exact as unknown as Omit<StrategyDecayGovernancePolicy, 'policyRevision'>,
  )))}`;
}

export function validateStrategyDecayGovernancePolicy(value: unknown): readonly string[] {
  const issues: string[] = [];
  const policy = recordWithExactKeys(snapshotStrategyDecayData(value), POLICY_KEYS);
  if (policy === null) return Object.freeze(['POLICY_SHAPE_INVALID']);
  if (!label(policy.policyId)) issues.push('POLICY_ID_INVALID');
  if (typeof policy.policyRevision !== 'string' || !POLICY_REVISION.test(policy.policyRevision)) {
    issues.push('POLICY_REVISION_INVALID');
  }
  if (policy.reduceAfterConsecutiveDegradedWindows !== 1) issues.push('REDUCE_MUST_FOLLOW_FIRST_DEGRADED_WINDOW');
  if (!positiveSafeInteger(policy.disableAfterConsecutiveDeadWindows)) issues.push('DISABLE_WINDOW_COUNT_INVALID');
  if (!positiveSafeInteger(policy.retireAfterConsecutiveDeadWindows)) issues.push('RETIRE_WINDOW_COUNT_INVALID');
  if (!positiveSafeInteger(policy.maximumRecentDecisions)
    || policy.maximumRecentDecisions > MAX_RECENT_DECISIONS) issues.push('RECENT_HISTORY_BOUND_INVALID');
  if (positiveSafeInteger(policy.disableAfterConsecutiveDeadWindows)
    && positiveSafeInteger(policy.retireAfterConsecutiveDeadWindows)
    && policy.disableAfterConsecutiveDeadWindows >= policy.retireAfterConsecutiveDeadWindows) {
    issues.push('RETIRE_THRESHOLD_MUST_EXCEED_DISABLE');
  }
  if (issues.length === 0) {
    try {
      const expected = deriveStrategyDecayPolicyRevision(
        policySemantics(policy as unknown as StrategyDecayGovernancePolicy) as Omit<StrategyDecayGovernancePolicy, 'policyRevision'>,
      );
      if (policy.policyRevision !== expected) issues.push('POLICY_REVISION_CONTENT_MISMATCH');
    } catch {
      issues.push('POLICY_REVISION_CONTENT_MISMATCH');
    }
  }
  return Object.freeze([...new Set(issues)].sort());
}

function validateWindow(value: unknown, path: string, evaluatedAtMs: number, issues: string[]): void {
  const window = recordWithExactKeys(value, WINDOW_KEYS);
  if (window === null) {
    issues.push(`${path}_SHAPE_INVALID`);
    return;
  }
  if (!isValidUtcMillis(window.startAtMs)) issues.push(`${path}_START_INVALID`);
  if (!isValidUtcMillis(window.endAtMs)) issues.push(`${path}_END_INVALID`);
  if (isValidUtcMillis(window.startAtMs) && isValidUtcMillis(window.endAtMs)
    && window.endAtMs <= window.startAtMs) issues.push(`${path}_ORDER_INVALID`);
  if (isValidUtcMillis(window.endAtMs) && isValidUtcMillis(evaluatedAtMs)
    && window.endAtMs > evaluatedAtMs) issues.push(`${path}_ENDS_AFTER_EVALUATION`);
}

function validateAxis(value: unknown, expectedAxis: string, issues: string[]): StrategyDecayAxisAssessment | null {
  const axis = recordWithExactKeys(value, AXIS_KEYS);
  if (axis === null) {
    issues.push(`AXIS_${expectedAxis}_SHAPE_INVALID`);
    return null;
  }
  if (axis.axis !== expectedAxis) issues.push(`AXIS_${expectedAxis}_ORDER_OR_IDENTITY_INVALID`);
  if (!(STRATEGY_DECAY_STATES as readonly unknown[]).includes(axis.state)) issues.push(`AXIS_${expectedAxis}_STATE_INVALID`);
  if (!nonNegativeSafeInteger(axis.baselineSampleCount)) issues.push(`AXIS_${expectedAxis}_BASELINE_COUNT_INVALID`);
  if (!nonNegativeSafeInteger(axis.currentSampleCount)) issues.push(`AXIS_${expectedAxis}_CURRENT_COUNT_INVALID`);
  if (axis.unit !== 'RATIO' && axis.unit !== 'QUOTE_ASSET') issues.push(`AXIS_${expectedAxis}_UNIT_INVALID`);
  if (!sortedUniqueStrings(axis.reasonCodes, 32, REASON_CODE)) issues.push(`AXIS_${expectedAxis}_REASONS_INVALID`);
  if (!sortedUniqueStrings(axis.evidenceIds, 20_000, LABEL)) issues.push(`AXIS_${expectedAxis}_EVIDENCE_IDS_INVALID`);
  const unknown = axis.state === 'UNKNOWN';
  if (unknown) {
    if (axis.baselineValue !== null || axis.currentValue !== null) issues.push(`AXIS_${expectedAxis}_UNKNOWN_VALUE_CONTRADICTION`);
  } else if (typeof axis.baselineValue !== 'string' || axis.baselineValue.length === 0
    || typeof axis.currentValue !== 'string' || axis.currentValue.length === 0
    || axis.baselineSampleCount === 0 || axis.currentSampleCount === 0) {
    issues.push(`AXIS_${expectedAxis}_KNOWN_VALUE_REQUIRED`);
  }
  return axis as unknown as StrategyDecayAxisAssessment;
}

function derivedMeasurementState(axes: readonly StrategyDecayAxisAssessment[]): StrategyDecayMeasurement['state'] {
  if (axes.some((axis) => axis.state === 'UNKNOWN')) return 'UNKNOWN';
  if (axes.some((axis) => axis.state === 'DEAD')) return 'DEAD';
  if (axes.some((axis) => axis.state === 'DEGRADED')) return 'DEGRADED';
  return 'STABLE';
}

function measurementIdentityMaterial(
  measurement: Omit<StrategyDecayMeasurement, 'measurementId'>,
): unknown {
  return {
    schema: measurement.schema,
    schemaVersion: measurement.schemaVersion,
    strategy: measurement.strategy,
    configVersion: measurement.configVersion,
    direction: measurement.direction,
    evaluatedAtMs: measurement.evaluatedAtMs,
    evidenceAuthority: measurement.evidenceAuthority,
    baselineWindow: measurement.baselineWindow,
    currentWindow: measurement.currentWindow,
    axes: measurement.axes,
    state: measurement.state,
    reasonCodes: measurement.reasonCodes,
  };
}

export function deriveStrategyDecayMeasurementId(
  measurement: Omit<StrategyDecayMeasurement, 'measurementId'>,
): string {
  const snapshot = snapshotStrategyDecayData(measurement);
  const exact = recordWithExactKeys(snapshot, MEASUREMENT_KEYS.filter((key) => key !== 'measurementId'));
  if (exact === null) throw new TypeError('strategy decay measurement material invalid');
  return `decaymeas_${stableHash128Hex(canonicalJson(measurementIdentityMaterial(
    exact as unknown as Omit<StrategyDecayMeasurement, 'measurementId'>,
  )))}`;
}

export function validateStrategyDecayMeasurement(value: unknown): readonly string[] {
  const issues: string[] = [];
  const measurement = recordWithExactKeys(snapshotStrategyDecayData(value), MEASUREMENT_KEYS);
  if (measurement === null) return Object.freeze(['MEASUREMENT_SHAPE_INVALID']);
  if (measurement.schema !== STRATEGY_DECAY_MEASUREMENT_SCHEMA) issues.push('MEASUREMENT_SCHEMA_INVALID');
  if (measurement.schemaVersion !== STRATEGY_DECAY_MEASUREMENT_SCHEMA_VERSION) issues.push('MEASUREMENT_SCHEMA_VERSION_INVALID');
  if (typeof measurement.measurementId !== 'string' || !MEASUREMENT_ID.test(measurement.measurementId)) issues.push('MEASUREMENT_ID_INVALID');
  if (!(STRATEGY_DECAY_SOURCES as readonly unknown[]).includes(measurement.strategy)) issues.push('MEASUREMENT_STRATEGY_INVALID');
  if (!label(measurement.configVersion)) issues.push('MEASUREMENT_CONFIG_VERSION_INVALID');
  if (!label(measurement.direction)) issues.push('MEASUREMENT_DIRECTION_INVALID');
  if (!isValidUtcMillis(measurement.evaluatedAtMs)) issues.push('MEASUREMENT_EVALUATED_AT_INVALID');
  if (!(STRATEGY_DECAY_EVIDENCE_AUTHORITIES as readonly unknown[]).includes(measurement.evidenceAuthority)) {
    issues.push('MEASUREMENT_AUTHORITY_INVALID');
  }
  if (!(STRATEGY_DECAY_STATES as readonly unknown[]).includes(measurement.state)) issues.push('MEASUREMENT_STATE_INVALID');
  if (!sortedUniqueStrings(measurement.reasonCodes, 64, REASON_CODE)) issues.push('MEASUREMENT_REASONS_INVALID');
  const measurementReasons = denseArray(measurement.reasonCodes, 64);
  if (measurementReasons !== null && measurementReasons.some((reason) => typeof reason === 'string'
    && (/^(?:DECAY_STATE_|GOVERNANCE_)/.test(reason)
      || reason === 'MORE_RESTRICTIVE_POSTURE_PRESERVED'
      || reason === 'COHORT_CHANGED_COUNTERS_RESET'))) {
    issues.push('MEASUREMENT_GOVERNANCE_REASON_NAMESPACE_FORBIDDEN');
  }
  validateWindow(measurement.baselineWindow, 'BASELINE_WINDOW', measurement.evaluatedAtMs as number, issues);
  validateWindow(measurement.currentWindow, 'CURRENT_WINDOW', measurement.evaluatedAtMs as number, issues);
  const baseline = recordWithExactKeys(measurement.baselineWindow, WINDOW_KEYS);
  const current = recordWithExactKeys(measurement.currentWindow, WINDOW_KEYS);
  if (baseline && current && isValidUtcMillis(baseline.endAtMs) && isValidUtcMillis(current.startAtMs)
    && baseline.endAtMs > current.startAtMs) issues.push('MEASUREMENT_WINDOWS_OVERLAP');
  const rawAxes = denseArray(measurement.axes, STRATEGY_DECAY_AXES.length);
  const axes: StrategyDecayAxisAssessment[] = [];
  if (rawAxes === null || rawAxes.length !== STRATEGY_DECAY_AXES.length) {
    issues.push('MEASUREMENT_AXES_INCOMPLETE');
  } else {
    for (let index = 0; index < STRATEGY_DECAY_AXES.length; index += 1) {
      const validated = validateAxis(rawAxes[index], STRATEGY_DECAY_AXES[index], issues);
      if (validated) axes.push(validated);
    }
  }
  if (axes.length === STRATEGY_DECAY_AXES.length
    && measurement.state !== derivedMeasurementState(axes)) issues.push('MEASUREMENT_STATE_AXIS_CONTRADICTION');
  if (measurement.evidenceAuthority !== 'PRODUCTION' && measurement.state !== 'UNKNOWN') {
    issues.push('NON_PRODUCTION_MEASUREMENT_MUST_BE_UNKNOWN');
  }
  if (issues.length === 0) {
    try {
      const material = { ...measurement } as Record<string, unknown>;
      delete material.measurementId;
      if (measurement.measurementId !== deriveStrategyDecayMeasurementId(
        material as unknown as Omit<StrategyDecayMeasurement, 'measurementId'>,
      )) issues.push('MEASUREMENT_ID_CONTENT_MISMATCH');
    } catch {
      issues.push('MEASUREMENT_ID_CONTENT_MISMATCH');
    }
  }
  return Object.freeze([...new Set(issues)].sort());
}

function historySummaryMaterial(
  summary: Omit<StrategyDecayDecisionSummary, 'historyDigest'>,
): unknown {
  return {
    decisionId: summary.decisionId,
    revision: summary.revision,
    strategy: summary.strategy,
    configVersion: summary.configVersion,
    direction: summary.direction,
    policyId: summary.policyId,
    policyRevision: summary.policyRevision,
    reduceAfterConsecutiveDegradedWindows: summary.reduceAfterConsecutiveDegradedWindows,
    disableAfterConsecutiveDeadWindows: summary.disableAfterConsecutiveDeadWindows,
    retireAfterConsecutiveDeadWindows: summary.retireAfterConsecutiveDeadWindows,
    measurementId: summary.measurementId,
    evaluatedAtMs: summary.evaluatedAtMs,
    measurementState: summary.measurementState,
    kind: summary.kind,
    nextPosture: summary.nextPosture,
    researchState: summary.researchState,
    researchCandidateId: summary.researchCandidateId,
    consecutiveDegradedWindows: summary.consecutiveDegradedWindows,
    consecutiveDeadWindows: summary.consecutiveDeadWindows,
    maximumRecentDecisions: summary.maximumRecentDecisions,
  };
}

export function deriveStrategyDecayHistoryDigest(
  previousHistoryDigest: string | null,
  summary: Omit<StrategyDecayDecisionSummary, 'historyDigest'>,
): string {
  if (previousHistoryDigest !== null && !HISTORY_DIGEST.test(previousHistoryDigest)) {
    throw new TypeError('previous strategy decay history digest invalid');
  }
  const snapshot = snapshotStrategyDecayData(summary);
  const exact = recordWithExactKeys(snapshot, SUMMARY_KEYS.filter((key) => key !== 'historyDigest'));
  if (exact === null) throw new TypeError('strategy decay summary material invalid');
  return `decayhist_${stableHash128Hex(canonicalJson({
    previousHistoryDigest,
    summary: historySummaryMaterial(exact as unknown as Omit<StrategyDecayDecisionSummary, 'historyDigest'>),
  }))}`;
}

function validateSummary(
  value: unknown,
  expectedRevision: number,
  issues: string[],
): Record<string, unknown> | null {
  const summary = recordWithExactKeys(value, SUMMARY_KEYS);
  if (summary === null) {
    issues.push('HISTORY_SUMMARY_SHAPE_INVALID');
    return null;
  }
  if (typeof summary.decisionId !== 'string' || !DECISION_ID.test(summary.decisionId)) issues.push('HISTORY_DECISION_ID_INVALID');
  if (summary.revision !== expectedRevision) issues.push('HISTORY_REVISION_SEQUENCE_INVALID');
  if (!(STRATEGY_DECAY_SOURCES as readonly unknown[]).includes(summary.strategy)) issues.push('HISTORY_SUMMARY_STRATEGY_INVALID');
  if (!label(summary.configVersion)) issues.push('HISTORY_SUMMARY_CONFIG_VERSION_INVALID');
  if (!label(summary.direction)) issues.push('HISTORY_SUMMARY_DIRECTION_INVALID');
  validateEmbeddedGovernancePolicy(summary, 'HISTORY_SUMMARY', issues);
  if (typeof summary.measurementId !== 'string' || !MEASUREMENT_ID.test(summary.measurementId)) issues.push('HISTORY_MEASUREMENT_ID_INVALID');
  if (!isValidUtcMillis(summary.evaluatedAtMs)) issues.push('HISTORY_EVALUATED_AT_INVALID');
  if (!(STRATEGY_DECAY_STATES as readonly unknown[]).includes(summary.measurementState)) issues.push('HISTORY_MEASUREMENT_STATE_INVALID');
  if (!(STRATEGY_DECAY_DECISION_KINDS as readonly unknown[]).includes(summary.kind)) issues.push('HISTORY_DECISION_KIND_INVALID');
  if (!(STRATEGY_DECAY_POSTURES as readonly unknown[]).includes(summary.nextPosture)) issues.push('HISTORY_POSTURE_INVALID');
  if (!(STRATEGY_DECAY_RESEARCH_STATES as readonly unknown[]).includes(summary.researchState)) issues.push('HISTORY_RESEARCH_STATE_INVALID');
  if (summary.researchState === 'NONE' ? summary.researchCandidateId !== null
    : typeof summary.researchCandidateId !== 'string' || !RESEARCH_ID.test(summary.researchCandidateId)) {
    issues.push('HISTORY_SUMMARY_RESEARCH_CANDIDATE_INVALID');
  }
  if (!nonNegativeSafeInteger(summary.consecutiveDegradedWindows)) issues.push('HISTORY_SUMMARY_DEGRADED_COUNT_INVALID');
  if (!nonNegativeSafeInteger(summary.consecutiveDeadWindows)) issues.push('HISTORY_SUMMARY_DEAD_COUNT_INVALID');
  if (nonNegativeSafeInteger(summary.consecutiveDegradedWindows)
    && nonNegativeSafeInteger(summary.consecutiveDeadWindows)
    && summary.consecutiveDeadWindows > summary.consecutiveDegradedWindows) {
    issues.push('HISTORY_SUMMARY_DEAD_COUNT_EXCEEDS_DEGRADED');
  }
  if (!positiveSafeInteger(summary.maximumRecentDecisions)
    || summary.maximumRecentDecisions > MAX_RECENT_DECISIONS) {
    issues.push('HISTORY_SUMMARY_RETENTION_BOUND_INVALID');
  }
  if (typeof summary.historyDigest !== 'string' || !HISTORY_DIGEST.test(summary.historyDigest)) {
    issues.push('HISTORY_SUMMARY_DIGEST_INVALID');
  }
  return summary;
}

export function validateStrategyDecayHistoryState(value: unknown): readonly string[] {
  const issues: string[] = [];
  const state = recordWithExactKeys(snapshotStrategyDecayData(value), STATE_KEYS);
  if (state === null) return Object.freeze(['HISTORY_STATE_SHAPE_INVALID']);
  if (state.schema !== STRATEGY_DECAY_HISTORY_SCHEMA) issues.push('HISTORY_SCHEMA_INVALID');
  if (state.schemaVersion !== STRATEGY_DECAY_HISTORY_SCHEMA_VERSION) issues.push('HISTORY_SCHEMA_VERSION_INVALID');
  if (!(STRATEGY_DECAY_SOURCES as readonly unknown[]).includes(state.strategy)) issues.push('HISTORY_STRATEGY_INVALID');
  if (!label(state.configVersion)) issues.push('HISTORY_CONFIG_VERSION_INVALID');
  if (!label(state.direction)) issues.push('HISTORY_DIRECTION_INVALID');
  validateEmbeddedGovernancePolicy(state, 'HISTORY', issues);
  if (!positiveSafeInteger(state.revision)) issues.push('HISTORY_REVISION_INVALID');
  if (!isValidUtcMillis(state.updatedAtMs)) issues.push('HISTORY_UPDATED_AT_INVALID');
  if (!(STRATEGY_DECAY_POSTURES as readonly unknown[]).includes(state.effectivePosture)) issues.push('HISTORY_POSTURE_INVALID');
  if (!(STRATEGY_DECAY_RESEARCH_STATES as readonly unknown[]).includes(state.researchState)) issues.push('HISTORY_RESEARCH_STATE_INVALID');
  if (state.researchState === 'NONE' ? state.researchCandidateId !== null
    : typeof state.researchCandidateId !== 'string' || !RESEARCH_ID.test(state.researchCandidateId)) {
    issues.push('HISTORY_RESEARCH_CANDIDATE_INVALID');
  }
  for (const key of ['consecutiveDegradedWindows', 'consecutiveDeadWindows', 'totalDecisionCount', 'compactedDecisionCount'] as const) {
    if (!nonNegativeSafeInteger(state[key])) issues.push(`HISTORY_${key.toUpperCase()}_INVALID`);
  }
  if (nonNegativeSafeInteger(state.consecutiveDeadWindows)
    && nonNegativeSafeInteger(state.consecutiveDegradedWindows)
    && state.consecutiveDeadWindows > state.consecutiveDegradedWindows) issues.push('HISTORY_DEAD_COUNT_EXCEEDS_DEGRADED');
  if (positiveSafeInteger(state.revision) && nonNegativeSafeInteger(state.totalDecisionCount)
    && state.revision !== state.totalDecisionCount) issues.push('HISTORY_TOTAL_REVISION_MISMATCH');
  if (typeof state.historyDigest !== 'string' || !HISTORY_DIGEST.test(state.historyDigest)) issues.push('HISTORY_DIGEST_INVALID');
  if (!positiveSafeInteger(state.maximumRecentDecisions)
    || state.maximumRecentDecisions > MAX_RECENT_DECISIONS) issues.push('HISTORY_RETENTION_BOUND_INVALID');
  if (nonNegativeSafeInteger(state.compactedDecisionCount)) {
    if (state.compactedDecisionCount === 0 ? state.compactedHistoryDigest !== null
      : typeof state.compactedHistoryDigest !== 'string' || !HISTORY_DIGEST.test(state.compactedHistoryDigest)) {
      issues.push('HISTORY_COMPACTION_ANCHOR_INVALID');
    }
  }
  const summaries = denseArray(state.recentDecisions, MAX_RECENT_DECISIONS);
  if (summaries === null) {
    issues.push('HISTORY_RECENT_DECISIONS_INVALID');
  } else if (nonNegativeSafeInteger(state.totalDecisionCount) && nonNegativeSafeInteger(state.compactedDecisionCount)) {
    if (state.compactedDecisionCount + summaries.length !== state.totalDecisionCount) issues.push('HISTORY_COMPACTION_COUNT_MISMATCH');
    if (positiveSafeInteger(state.maximumRecentDecisions)
      && summaries.length > state.maximumRecentDecisions) issues.push('HISTORY_RETENTION_BOUND_EXCEEDED');
    const validated = summaries.map((summary, index) => validateSummary(
      summary,
      state.compactedDecisionCount as number + index + 1,
      issues,
    ));
    const decisionIds = validated.flatMap((summary) => typeof summary?.decisionId === 'string' ? [summary.decisionId] : []);
    const measurementIds = validated.flatMap((summary) => typeof summary?.measurementId === 'string' ? [summary.measurementId] : []);
    if (new Set(decisionIds).size !== decisionIds.length) issues.push('HISTORY_DUPLICATE_DECISION_ID');
    if (new Set(measurementIds).size !== measurementIds.length) issues.push('HISTORY_DUPLICATE_MEASUREMENT_ID');
    let previousDigest = state.compactedHistoryDigest as string | null;
    let previousSummary: Record<string, unknown> | null = null;
    for (const summary of validated) {
      if (summary === null) continue;
      if (summary.strategy !== state.strategy) issues.push('HISTORY_SUMMARY_STRATEGY_MISMATCH');
      if (summary.direction !== state.direction) issues.push('HISTORY_SUMMARY_DIRECTION_MISMATCH');
      if (previousSummary !== null) {
        if (isValidUtcMillis(previousSummary.evaluatedAtMs)
          && isValidUtcMillis(summary.evaluatedAtMs)
          && summary.evaluatedAtMs <= previousSummary.evaluatedAtMs) {
          issues.push('HISTORY_EVALUATED_AT_ORDER_INVALID');
        }
        if ((STRATEGY_DECAY_POSTURES as readonly unknown[]).includes(previousSummary.nextPosture)
          && (STRATEGY_DECAY_POSTURES as readonly unknown[]).includes(summary.nextPosture)
          && STRATEGY_DECAY_POSTURES.indexOf(summary.nextPosture as StrategyDecayPosture)
            < STRATEGY_DECAY_POSTURES.indexOf(previousSummary.nextPosture as StrategyDecayPosture)) {
          issues.push('HISTORY_POSTURE_RELAXATION_FORBIDDEN');
        }
        if (previousSummary.researchState === 'PENDING_REVIEW'
          && (summary.researchState !== 'PENDING_REVIEW'
            || summary.researchCandidateId !== previousSummary.researchCandidateId)) {
          issues.push('HISTORY_RESEARCH_RELAXATION_FORBIDDEN');
        }
      }
      if ((previousDigest === null || HISTORY_DIGEST.test(previousDigest))
        && typeof summary.historyDigest === 'string') {
        try {
          const material = { ...summary } as Record<string, unknown>;
          delete material.historyDigest;
          const expectedDigest = deriveStrategyDecayHistoryDigest(
            previousDigest,
            material as unknown as Omit<StrategyDecayDecisionSummary, 'historyDigest'>,
          );
          if (summary.historyDigest !== expectedDigest) issues.push('HISTORY_DIGEST_CONTENT_MISMATCH');
        } catch {
          issues.push('HISTORY_DIGEST_CONTENT_MISMATCH');
        }
      }
      previousDigest = typeof summary.historyDigest === 'string' ? summary.historyDigest : previousDigest;
      previousSummary = summary;
    }
    const latest = validated.at(-1);
    if (latest === null || latest === undefined) {
      issues.push('HISTORY_LATEST_SUMMARY_MISSING');
    } else {
      if (latest.strategy !== state.strategy
        || latest.configVersion !== state.configVersion
        || latest.direction !== state.direction
        || latest.policyId !== state.policyId
        || latest.policyRevision !== state.policyRevision
        || latest.reduceAfterConsecutiveDegradedWindows !== state.reduceAfterConsecutiveDegradedWindows
        || latest.disableAfterConsecutiveDeadWindows !== state.disableAfterConsecutiveDeadWindows
        || latest.retireAfterConsecutiveDeadWindows !== state.retireAfterConsecutiveDeadWindows
        || latest.revision !== state.revision
        || latest.evaluatedAtMs !== state.updatedAtMs
        || latest.nextPosture !== state.effectivePosture
        || latest.researchState !== state.researchState
        || latest.researchCandidateId !== state.researchCandidateId
        || latest.consecutiveDegradedWindows !== state.consecutiveDegradedWindows
        || latest.consecutiveDeadWindows !== state.consecutiveDeadWindows
        || latest.maximumRecentDecisions !== state.maximumRecentDecisions) {
        issues.push('HISTORY_LATEST_SUMMARY_STATE_MISMATCH');
      }
      if (latest.historyDigest !== state.historyDigest) issues.push('HISTORY_HEAD_DIGEST_MISMATCH');
    }
  }
  return Object.freeze([...new Set(issues)].sort());
}

function targetPosture(kind: StrategyDecayDecisionKind): StrategyDecayPosture {
  if (kind === 'RETIRE') return 'RETIRED';
  if (kind === 'DISABLE') return 'DISABLED';
  if (kind === 'REDUCE') return 'REDUCED';
  return 'ENABLED';
}

function decisionIdentityMaterial(decision: Omit<StrategyDecayDecision, 'schema' | 'schemaVersion' | 'decisionId' | 'automaticResearchPromotion' | 'executionAuthority'>): unknown {
  return {
    revision: decision.revision,
    strategy: decision.strategy,
    configVersion: decision.configVersion,
    direction: decision.direction,
    policyId: decision.policyId,
    policyRevision: decision.policyRevision,
    reduceAfterConsecutiveDegradedWindows: decision.reduceAfterConsecutiveDegradedWindows,
    disableAfterConsecutiveDeadWindows: decision.disableAfterConsecutiveDeadWindows,
    retireAfterConsecutiveDeadWindows: decision.retireAfterConsecutiveDeadWindows,
    maximumRecentDecisions: decision.maximumRecentDecisions,
    measurementId: decision.measurementId,
    evaluatedAtMs: decision.evaluatedAtMs,
    measurementState: decision.measurementState,
    kind: decision.kind,
    priorPosture: decision.priorPosture,
    nextPosture: decision.nextPosture,
    researchState: decision.researchState,
    researchCandidateId: decision.researchCandidateId,
    reasonCodes: decision.reasonCodes,
  };
}

function decayStateFromDecisionRecord(decision: Record<string, unknown>): StrategyDecayState | null {
  return (STRATEGY_DECAY_STATES as readonly unknown[]).includes(decision.measurementState)
    ? decision.measurementState as StrategyDecayState
    : null;
}

export function strategyDecayStateFromDecision(value: unknown): StrategyDecayState | null {
  const decision = recordWithExactKeys(snapshotStrategyDecayData(value), DECISION_KEYS);
  return decision === null ? null : decayStateFromDecisionRecord(decision);
}

export function validateStrategyDecayDecision(value: unknown): readonly string[] {
  const issues: string[] = [];
  const decision = recordWithExactKeys(snapshotStrategyDecayData(value), DECISION_KEYS);
  if (decision === null) return Object.freeze(['DECISION_SHAPE_INVALID']);
  if (decision.schema !== STRATEGY_DECAY_DECISION_SCHEMA) issues.push('DECISION_SCHEMA_INVALID');
  if (decision.schemaVersion !== STRATEGY_DECAY_DECISION_SCHEMA_VERSION) issues.push('DECISION_SCHEMA_VERSION_INVALID');
  if (typeof decision.decisionId !== 'string' || !DECISION_ID.test(decision.decisionId)) issues.push('DECISION_ID_INVALID');
  if (!positiveSafeInteger(decision.revision)) issues.push('DECISION_REVISION_INVALID');
  if (!(STRATEGY_DECAY_SOURCES as readonly unknown[]).includes(decision.strategy)) issues.push('DECISION_STRATEGY_INVALID');
  if (!label(decision.configVersion)) issues.push('DECISION_CONFIG_VERSION_INVALID');
  if (!label(decision.direction)) issues.push('DECISION_DIRECTION_INVALID');
  validateEmbeddedGovernancePolicy(decision, 'DECISION', issues);
  if (typeof decision.measurementId !== 'string' || !MEASUREMENT_ID.test(decision.measurementId)) issues.push('DECISION_MEASUREMENT_ID_INVALID');
  if (!isValidUtcMillis(decision.evaluatedAtMs)) issues.push('DECISION_EVALUATED_AT_INVALID');
  if (!(STRATEGY_DECAY_DECISION_KINDS as readonly unknown[]).includes(decision.kind)) issues.push('DECISION_KIND_INVALID');
  if (!(STRATEGY_DECAY_POSTURES as readonly unknown[]).includes(decision.priorPosture)
    || !(STRATEGY_DECAY_POSTURES as readonly unknown[]).includes(decision.nextPosture)) {
    issues.push('DECISION_POSTURE_INVALID');
  } else {
    const prior = STRATEGY_DECAY_POSTURES.indexOf(decision.priorPosture as StrategyDecayPosture);
    const next = STRATEGY_DECAY_POSTURES.indexOf(decision.nextPosture as StrategyDecayPosture);
    if (next < prior) issues.push('DECISION_POSTURE_RELAXATION_FORBIDDEN');
    if ((STRATEGY_DECAY_DECISION_KINDS as readonly unknown[]).includes(decision.kind)) {
      const required = STRATEGY_DECAY_POSTURES.indexOf(targetPosture(decision.kind as StrategyDecayDecisionKind));
      if (next < required) issues.push('DECISION_ACTION_POSTURE_CONTRADICTION');
    }
  }
  if (!(STRATEGY_DECAY_RESEARCH_STATES as readonly unknown[]).includes(decision.researchState)) issues.push('DECISION_RESEARCH_STATE_INVALID');
  if (decision.researchState === 'NONE' ? decision.researchCandidateId !== null
    : typeof decision.researchCandidateId !== 'string' || !RESEARCH_ID.test(decision.researchCandidateId)) {
    issues.push('DECISION_RESEARCH_CANDIDATE_INVALID');
  }
  if ((decision.kind === 'REDUCE' || decision.kind === 'DISABLE' || decision.kind === 'RETIRE')
    && decision.researchState !== 'PENDING_REVIEW') issues.push('DECISION_ACTION_RESEARCH_REDIRECTION_MISSING');
  if (!sortedUniqueStrings(decision.reasonCodes, 64, REASON_CODE)) issues.push('DECISION_REASONS_INVALID');
  const measurementState = decayStateFromDecisionRecord(decision);
  if (measurementState === null) {
    issues.push('DECISION_MEASUREMENT_STATE_INVALID');
  } else if ((measurementState === 'UNKNOWN' && decision.kind !== 'HOLD_UNKNOWN')
    || (measurementState === 'STABLE' && decision.kind !== 'HOLD_STABLE')
    || (measurementState === 'DEGRADED' && decision.kind !== 'REDUCE')
    || (measurementState === 'DEAD' && !['REDUCE', 'DISABLE', 'RETIRE'].includes(decision.kind as string))) {
    issues.push('DECISION_MEASUREMENT_STATE_KIND_CONTRADICTION');
  }
  const decisionReasons = denseArray(decision.reasonCodes, 64);
  if (decisionReasons !== null && measurementState !== null
    && (decisionReasons.filter((reason) => reason === `DECAY_STATE_${measurementState}`).length !== 1
      || decisionReasons.some((reason) => typeof reason === 'string'
        && reason.startsWith('DECAY_STATE_') && reason !== `DECAY_STATE_${measurementState}`))) {
    issues.push('DECISION_MEASUREMENT_STATE_REASON_CONTRADICTION');
  }
  if (decisionReasons !== null && (STRATEGY_DECAY_DECISION_KINDS as readonly unknown[]).includes(decision.kind)
    && (decisionReasons.filter((reason) => reason === `GOVERNANCE_${decision.kind as string}`).length !== 1
      || decisionReasons.some((reason) => typeof reason === 'string'
        && reason.startsWith('GOVERNANCE_') && reason !== `GOVERNANCE_${decision.kind as string}`))) {
    issues.push('DECISION_KIND_REASON_CONTRADICTION');
  }
  if (decisionReasons !== null
    && (STRATEGY_DECAY_DECISION_KINDS as readonly unknown[]).includes(decision.kind)
    && (STRATEGY_DECAY_POSTURES as readonly unknown[]).includes(decision.nextPosture)
    && decisionReasons.includes('MORE_RESTRICTIVE_POSTURE_PRESERVED')
      !== (decision.nextPosture !== targetPosture(decision.kind as StrategyDecayDecisionKind))) {
    issues.push('DECISION_POSTURE_REASON_CONTRADICTION');
  }
  if (decision.automaticResearchPromotion !== false) issues.push('DECISION_AUTOMATIC_RESEARCH_PROMOTION_FORBIDDEN');
  if (decision.executionAuthority !== 'NONE') issues.push('DECISION_EXECUTION_AUTHORITY_FORBIDDEN');
  if (issues.length === 0) {
    try {
      const expected = `decaydec_${stableHash128Hex(canonicalJson(decisionIdentityMaterial(
        decision as unknown as StrategyDecayDecision,
      )))}`;
      if (decision.decisionId !== expected) issues.push('DECISION_ID_CONTENT_MISMATCH');
    } catch {
      issues.push('DECISION_ID_CONTENT_MISMATCH');
    }
  }
  return Object.freeze([...new Set(issues)].sort());
}

function moreRestrictive(left: StrategyDecayPosture, right: StrategyDecayPosture): StrategyDecayPosture {
  return STRATEGY_DECAY_POSTURES.indexOf(left) >= STRATEGY_DECAY_POSTURES.indexOf(right) ? left : right;
}

function decisionKind(
  measurement: StrategyDecayMeasurement,
  degradedWindows: number,
  deadWindows: number,
  policy: StrategyDecayGovernancePolicy,
): StrategyDecayDecisionKind {
  if (measurement.state === 'UNKNOWN') return 'HOLD_UNKNOWN';
  if (measurement.state === 'STABLE') return 'HOLD_STABLE';
  if (measurement.state === 'DEAD') {
    if (deadWindows >= policy.retireAfterConsecutiveDeadWindows) return 'RETIRE';
    if (deadWindows >= policy.disableAfterConsecutiveDeadWindows) return 'DISABLE';
    return 'REDUCE';
  }
  return degradedWindows >= policy.reduceAfterConsecutiveDegradedWindows ? 'REDUCE' : 'HOLD_UNKNOWN';
}

export function summarizeStrategyDecayDecision(
  decision: StrategyDecayDecision,
  consecutiveDegradedWindows: number,
  consecutiveDeadWindows: number,
  maximumRecentDecisions: number,
  previousHistoryDigest: string | null,
): StrategyDecayDecisionSummary {
  const snapshot = snapshotStrategyDecayData(decision);
  const exact = recordWithExactKeys(snapshot, DECISION_KEYS);
  if (exact === null || validateStrategyDecayDecision(exact).length > 0
    || !nonNegativeSafeInteger(consecutiveDegradedWindows)
    || !nonNegativeSafeInteger(consecutiveDeadWindows)
    || consecutiveDeadWindows > consecutiveDegradedWindows
    || !positiveSafeInteger(maximumRecentDecisions)
    || maximumRecentDecisions > MAX_RECENT_DECISIONS) {
    throw new TypeError('strategy decay decision summary input invalid');
  }
  const safeDecision = exact as unknown as StrategyDecayDecision;
  const material: Omit<StrategyDecayDecisionSummary, 'historyDigest'> = {
    decisionId: safeDecision.decisionId,
    revision: safeDecision.revision,
    strategy: safeDecision.strategy,
    configVersion: safeDecision.configVersion,
    direction: safeDecision.direction,
    policyId: safeDecision.policyId,
    policyRevision: safeDecision.policyRevision,
    reduceAfterConsecutiveDegradedWindows: safeDecision.reduceAfterConsecutiveDegradedWindows,
    disableAfterConsecutiveDeadWindows: safeDecision.disableAfterConsecutiveDeadWindows,
    retireAfterConsecutiveDeadWindows: safeDecision.retireAfterConsecutiveDeadWindows,
    measurementId: safeDecision.measurementId,
    evaluatedAtMs: safeDecision.evaluatedAtMs,
    measurementState: safeDecision.measurementState,
    kind: safeDecision.kind,
    nextPosture: safeDecision.nextPosture,
    researchState: safeDecision.researchState,
    researchCandidateId: safeDecision.researchCandidateId,
    consecutiveDegradedWindows,
    consecutiveDeadWindows,
    maximumRecentDecisions,
  };
  return deepFreeze({
    ...material,
    historyDigest: deriveStrategyDecayHistoryDigest(previousHistoryDigest, material),
  });
}

/**
 * Govern one immutable measurement. Decisions are monotonic: measurement
 * recovery never silently re-enables a reduced/disabled/retired strategy, and
 * research redirection can only enter PENDING_REVIEW.
 */
export function evaluateStrategyDecayGovernance(input: {
  readonly policy: Readonly<StrategyDecayGovernancePolicy>;
  readonly measurement: Readonly<StrategyDecayMeasurement>;
  readonly previousState: Readonly<StrategyDecayHistoryState> | null;
}): StrategyDecayEvaluationResult {
  const exact = recordWithExactKeys(snapshotStrategyDecayData(input), ['policy', 'measurement', 'previousState']);
  if (exact === null) return Object.freeze({ ok: false, reasonCodes: Object.freeze(['GOVERNANCE_INPUT_SHAPE_INVALID']) });
  const policyIssues = validateStrategyDecayGovernancePolicy(exact.policy);
  const measurementIssues = validateStrategyDecayMeasurement(exact.measurement);
  const stateIssues = exact.previousState === null ? Object.freeze([]) : validateStrategyDecayHistoryState(exact.previousState);
  const issues = [...policyIssues, ...measurementIssues, ...stateIssues];
  if (issues.length > 0) return Object.freeze({ ok: false, reasonCodes: Object.freeze([...new Set(issues)].sort()) });

  const policy = exact.policy as unknown as StrategyDecayGovernancePolicy;
  const measurement = exact.measurement as unknown as StrategyDecayMeasurement;
  const previous = exact.previousState as StrategyDecayHistoryState | null;
  if (previous !== null && previous.strategy !== measurement.strategy) {
    return Object.freeze({ ok: false, reasonCodes: Object.freeze(['HISTORY_STRATEGY_MISMATCH']) });
  }
  if (previous !== null && previous.direction !== measurement.direction) {
    return Object.freeze({ ok: false, reasonCodes: Object.freeze(['HISTORY_DIRECTION_MISMATCH']) });
  }
  if (previous !== null) {
    const sequenceIssues: string[] = [];
    if (measurement.evaluatedAtMs <= previous.updatedAtMs) sequenceIssues.push('MEASUREMENT_TIME_NOT_STRICTLY_INCREASING');
    if (previous.recentDecisions.some((summary) => summary.measurementId === measurement.measurementId)) {
      sequenceIssues.push('MEASUREMENT_ID_REPLAYED');
    }
    if (sequenceIssues.length > 0) {
      return Object.freeze({ ok: false, reasonCodes: Object.freeze(sequenceIssues.sort()) });
    }
  }
  const sameCohort = previous !== null
    && previous.configVersion === measurement.configVersion
    && previous.direction === measurement.direction
    && previous.policyRevision === policy.policyRevision;
  const priorDegraded = sameCohort ? previous.consecutiveDegradedWindows : 0;
  const priorDead = sameCohort ? previous.consecutiveDeadWindows : 0;
  let degradedWindows = priorDegraded;
  let deadWindows = priorDead;
  if (measurement.state === 'STABLE') {
    degradedWindows = 0;
    deadWindows = 0;
  } else if (measurement.state === 'DEGRADED') {
    degradedWindows += 1;
    deadWindows = 0;
  } else if (measurement.state === 'DEAD') {
    degradedWindows += 1;
    deadWindows += 1;
  }

  const kind = decisionKind(measurement, degradedWindows, deadWindows, policy);
  const priorPosture = previous?.effectivePosture ?? 'ENABLED';
  const nextPosture = moreRestrictive(priorPosture, targetPosture(kind));
  const actionRequiresResearch = kind === 'REDUCE' || kind === 'DISABLE' || kind === 'RETIRE';
  const researchState: StrategyDecayResearchState = previous?.researchState === 'PENDING_REVIEW' || actionRequiresResearch
    ? 'PENDING_REVIEW'
    : 'NONE';
  const revision = (previous?.revision ?? 0) + 1;
  const researchCandidateId = researchState === 'PENDING_REVIEW'
    ? previous?.researchCandidateId ?? `decayresearch_${stableHash128Hex(canonicalJson({
        strategy: measurement.strategy,
        configVersion: measurement.configVersion,
        direction: measurement.direction,
        firstMeasurementId: measurement.measurementId,
        revision,
      }))}`
    : null;
  const reasonCodes = Object.freeze([...new Set([
    ...measurement.reasonCodes,
    `DECAY_STATE_${measurement.state}`,
    `GOVERNANCE_${kind}`,
    ...(nextPosture !== targetPosture(kind) ? ['MORE_RESTRICTIVE_POSTURE_PRESERVED'] : []),
    ...(sameCohort || previous === null ? [] : ['COHORT_CHANGED_COUNTERS_RESET']),
  ])].sort());
  const decisionMaterial = {
    revision,
    strategy: measurement.strategy,
    configVersion: measurement.configVersion,
    direction: measurement.direction,
    policyId: policy.policyId,
    policyRevision: policy.policyRevision,
    reduceAfterConsecutiveDegradedWindows: policy.reduceAfterConsecutiveDegradedWindows,
    disableAfterConsecutiveDeadWindows: policy.disableAfterConsecutiveDeadWindows,
    retireAfterConsecutiveDeadWindows: policy.retireAfterConsecutiveDeadWindows,
    maximumRecentDecisions: policy.maximumRecentDecisions,
    measurementId: measurement.measurementId,
    evaluatedAtMs: measurement.evaluatedAtMs,
    measurementState: measurement.state,
    kind,
    priorPosture,
    nextPosture,
    researchState,
    researchCandidateId,
    reasonCodes,
  };
  const decision: StrategyDecayDecision = deepFreeze({
    schema: STRATEGY_DECAY_DECISION_SCHEMA,
    schemaVersion: STRATEGY_DECAY_DECISION_SCHEMA_VERSION,
    decisionId: `decaydec_${stableHash128Hex(canonicalJson(decisionIdentityMaterial(
      decisionMaterial as Omit<StrategyDecayDecision, 'schema' | 'schemaVersion' | 'decisionId' | 'automaticResearchPromotion' | 'executionAuthority'>,
    )))}`,
    ...decisionMaterial,
    automaticResearchPromotion: false,
    executionAuthority: 'NONE',
  });
  const maximumRecent = policy.maximumRecentDecisions;
  const appendedSummary = summarizeStrategyDecayDecision(
    decision,
    degradedWindows,
    deadWindows,
    maximumRecent,
    previous?.historyDigest ?? null,
  );
  const allRecentDecisions = [
    ...(previous?.recentDecisions ?? []),
    appendedSummary,
  ];
  const removedSummaries = allRecentDecisions.slice(0, Math.max(0, allRecentDecisions.length - maximumRecent));
  const recentDecisions = Object.freeze(allRecentDecisions.slice(-maximumRecent));
  const totalDecisionCount = (previous?.totalDecisionCount ?? 0) + 1;
  const compactedDecisionCount = totalDecisionCount - recentDecisions.length;
  const compactedHistoryDigest = removedSummaries.at(-1)?.historyDigest
    ?? previous?.compactedHistoryDigest
    ?? null;
  const historyDigest = appendedSummary.historyDigest;
  const nextState: StrategyDecayHistoryState = deepFreeze({
    schema: STRATEGY_DECAY_HISTORY_SCHEMA,
    schemaVersion: STRATEGY_DECAY_HISTORY_SCHEMA_VERSION,
    strategy: measurement.strategy,
    configVersion: measurement.configVersion,
    direction: measurement.direction,
    policyId: policy.policyId,
    policyRevision: policy.policyRevision,
    reduceAfterConsecutiveDegradedWindows: policy.reduceAfterConsecutiveDegradedWindows,
    disableAfterConsecutiveDeadWindows: policy.disableAfterConsecutiveDeadWindows,
    retireAfterConsecutiveDeadWindows: policy.retireAfterConsecutiveDeadWindows,
    revision,
    updatedAtMs: measurement.evaluatedAtMs,
    effectivePosture: nextPosture,
    researchState,
    researchCandidateId,
    consecutiveDegradedWindows: degradedWindows,
    consecutiveDeadWindows: deadWindows,
    totalDecisionCount,
    compactedDecisionCount,
    maximumRecentDecisions: maximumRecent,
    compactedHistoryDigest,
    recentDecisions,
    historyDigest,
  });
  const resultIssues = validateStrategyDecayHistoryState(nextState);
  const decisionIssues = validateStrategyDecayDecision(decision);
  if (resultIssues.length > 0 || decisionIssues.length > 0) {
    return Object.freeze({ ok: false, reasonCodes: Object.freeze([...new Set([...resultIssues, ...decisionIssues])].sort()) });
  }
  return Object.freeze({ ok: true, decision, nextState });
}
