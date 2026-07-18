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
} from './types.js';

const MAX_RECENT_DECISIONS = 64;
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
  'schema', 'schemaVersion', 'strategy', 'configVersion', 'policyRevision', 'revision',
  'effectivePosture', 'researchState', 'researchCandidateId',
  'consecutiveDegradedWindows', 'consecutiveDeadWindows', 'totalDecisionCount',
  'compactedDecisionCount', 'recentDecisions', 'historyDigest',
] as const);
const SUMMARY_KEYS = Object.freeze([
  'decisionId', 'revision', 'measurementId', 'evaluatedAtMs', 'kind', 'nextPosture',
  'researchState',
] as const);
const DECISION_KEYS = Object.freeze([
  'schema', 'schemaVersion', 'decisionId', 'revision', 'strategy', 'configVersion',
  'policyRevision', 'measurementId', 'evaluatedAtMs', 'kind', 'priorPosture',
  'nextPosture', 'researchState', 'researchCandidateId', 'reasonCodes',
  'automaticResearchPromotion', 'executionAuthority',
] as const);

function recordWithExactKeys(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
      return null;
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function denseArray(value: unknown, maximum: number): readonly unknown[] | null {
  try {
    if (!Array.isArray(value) || value.length > maximum) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string'
      || (key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)))) return null;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) return null;
    }
    return value;
  } catch {
    return null;
  }
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
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function label(value: unknown): value is string {
  return typeof value === 'string' && LABEL.test(value);
}

function deepFreeze<T>(value: T, seen: Set<object> = new Set()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Object.keys(object)) deepFreeze((object as Record<string, unknown>)[key], seen);
  return Object.freeze(value);
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
  return `decaypolicy_${stableHash128Hex(canonicalJson(policySemantics(policy)))}`;
}

export function validateStrategyDecayGovernancePolicy(value: unknown): readonly string[] {
  const issues: string[] = [];
  const policy = recordWithExactKeys(value, POLICY_KEYS);
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
      const expected = deriveStrategyDecayPolicyRevision(policy as unknown as StrategyDecayGovernancePolicy);
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

export function validateStrategyDecayMeasurement(value: unknown): readonly string[] {
  const issues: string[] = [];
  const measurement = recordWithExactKeys(value, MEASUREMENT_KEYS);
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
  return Object.freeze([...new Set(issues)].sort());
}

function validateSummary(value: unknown, expectedRevision: number, issues: string[]): void {
  const summary = recordWithExactKeys(value, SUMMARY_KEYS);
  if (summary === null) {
    issues.push('HISTORY_SUMMARY_SHAPE_INVALID');
    return;
  }
  if (typeof summary.decisionId !== 'string' || !DECISION_ID.test(summary.decisionId)) issues.push('HISTORY_DECISION_ID_INVALID');
  if (summary.revision !== expectedRevision) issues.push('HISTORY_REVISION_SEQUENCE_INVALID');
  if (typeof summary.measurementId !== 'string' || !MEASUREMENT_ID.test(summary.measurementId)) issues.push('HISTORY_MEASUREMENT_ID_INVALID');
  if (!isValidUtcMillis(summary.evaluatedAtMs)) issues.push('HISTORY_EVALUATED_AT_INVALID');
  if (!(STRATEGY_DECAY_DECISION_KINDS as readonly unknown[]).includes(summary.kind)) issues.push('HISTORY_DECISION_KIND_INVALID');
  if (!(STRATEGY_DECAY_POSTURES as readonly unknown[]).includes(summary.nextPosture)) issues.push('HISTORY_POSTURE_INVALID');
  if (!(STRATEGY_DECAY_RESEARCH_STATES as readonly unknown[]).includes(summary.researchState)) issues.push('HISTORY_RESEARCH_STATE_INVALID');
}

export function validateStrategyDecayHistoryState(value: unknown): readonly string[] {
  const issues: string[] = [];
  const state = recordWithExactKeys(value, STATE_KEYS);
  if (state === null) return Object.freeze(['HISTORY_STATE_SHAPE_INVALID']);
  if (state.schema !== STRATEGY_DECAY_HISTORY_SCHEMA) issues.push('HISTORY_SCHEMA_INVALID');
  if (state.schemaVersion !== STRATEGY_DECAY_HISTORY_SCHEMA_VERSION) issues.push('HISTORY_SCHEMA_VERSION_INVALID');
  if (!(STRATEGY_DECAY_SOURCES as readonly unknown[]).includes(state.strategy)) issues.push('HISTORY_STRATEGY_INVALID');
  if (!label(state.configVersion)) issues.push('HISTORY_CONFIG_VERSION_INVALID');
  if (typeof state.policyRevision !== 'string' || !POLICY_REVISION.test(state.policyRevision)) issues.push('HISTORY_POLICY_REVISION_INVALID');
  if (!positiveSafeInteger(state.revision)) issues.push('HISTORY_REVISION_INVALID');
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
  const summaries = denseArray(state.recentDecisions, MAX_RECENT_DECISIONS);
  if (summaries === null) {
    issues.push('HISTORY_RECENT_DECISIONS_INVALID');
  } else if (nonNegativeSafeInteger(state.totalDecisionCount) && nonNegativeSafeInteger(state.compactedDecisionCount)) {
    if (state.compactedDecisionCount + summaries.length !== state.totalDecisionCount) issues.push('HISTORY_COMPACTION_COUNT_MISMATCH');
    summaries.forEach((summary, index) => validateSummary(summary, state.compactedDecisionCount as number + index + 1, issues));
    const ids = summaries.map((summary) => recordWithExactKeys(summary, SUMMARY_KEYS)?.decisionId);
    if (new Set(ids).size !== ids.length) issues.push('HISTORY_DUPLICATE_DECISION_ID');
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
    policyRevision: decision.policyRevision,
    measurementId: decision.measurementId,
    evaluatedAtMs: decision.evaluatedAtMs,
    kind: decision.kind,
    priorPosture: decision.priorPosture,
    nextPosture: decision.nextPosture,
    researchState: decision.researchState,
    researchCandidateId: decision.researchCandidateId,
    reasonCodes: decision.reasonCodes,
  };
}

export function validateStrategyDecayDecision(value: unknown): readonly string[] {
  const issues: string[] = [];
  const decision = recordWithExactKeys(value, DECISION_KEYS);
  if (decision === null) return Object.freeze(['DECISION_SHAPE_INVALID']);
  if (decision.schema !== STRATEGY_DECAY_DECISION_SCHEMA) issues.push('DECISION_SCHEMA_INVALID');
  if (decision.schemaVersion !== STRATEGY_DECAY_DECISION_SCHEMA_VERSION) issues.push('DECISION_SCHEMA_VERSION_INVALID');
  if (typeof decision.decisionId !== 'string' || !DECISION_ID.test(decision.decisionId)) issues.push('DECISION_ID_INVALID');
  if (!positiveSafeInteger(decision.revision)) issues.push('DECISION_REVISION_INVALID');
  if (!(STRATEGY_DECAY_SOURCES as readonly unknown[]).includes(decision.strategy)) issues.push('DECISION_STRATEGY_INVALID');
  if (!label(decision.configVersion)) issues.push('DECISION_CONFIG_VERSION_INVALID');
  if (typeof decision.policyRevision !== 'string' || !POLICY_REVISION.test(decision.policyRevision)) issues.push('DECISION_POLICY_REVISION_INVALID');
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

function decisionSummary(decision: StrategyDecayDecision): StrategyDecayDecisionSummary {
  return Object.freeze({
    decisionId: decision.decisionId,
    revision: decision.revision,
    measurementId: decision.measurementId,
    evaluatedAtMs: decision.evaluatedAtMs,
    kind: decision.kind,
    nextPosture: decision.nextPosture,
    researchState: decision.researchState,
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
  const exact = recordWithExactKeys(input, ['policy', 'measurement', 'previousState']);
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
  const sameCohort = previous !== null
    && previous.configVersion === measurement.configVersion
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
    policyRevision: policy.policyRevision,
    measurementId: measurement.measurementId,
    evaluatedAtMs: measurement.evaluatedAtMs,
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
  const recentDecisions = Object.freeze([
    ...(previous?.recentDecisions ?? []),
    decisionSummary(decision),
  ].slice(-maximumRecent));
  const totalDecisionCount = (previous?.totalDecisionCount ?? 0) + 1;
  const historyDigest = `decayhist_${stableHash128Hex(canonicalJson({
    previousHistoryDigest: previous?.historyDigest ?? null,
    decisionId: decision.decisionId,
    revision,
  }))}`;
  const nextState: StrategyDecayHistoryState = deepFreeze({
    schema: STRATEGY_DECAY_HISTORY_SCHEMA,
    schemaVersion: STRATEGY_DECAY_HISTORY_SCHEMA_VERSION,
    strategy: measurement.strategy,
    configVersion: measurement.configVersion,
    policyRevision: policy.policyRevision,
    revision,
    effectivePosture: nextPosture,
    researchState,
    researchCandidateId,
    consecutiveDegradedWindows: degradedWindows,
    consecutiveDeadWindows: deadWindows,
    totalDecisionCount,
    compactedDecisionCount: totalDecisionCount - recentDecisions.length,
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
