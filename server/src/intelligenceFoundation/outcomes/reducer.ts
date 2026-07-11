import {
  canonicalJson,
  stableId,
  validateFrozenPreEventRecord,
  validateNoSecretFields,
  validateTruthMetadata,
  type OutcomeMetrics,
  type ValidationResult,
} from '../contracts/index.js';
import type { AttributedOutcomeLabel, IntelligenceOutcomeState, OutcomeStateEvent } from './types.js';
import { compareText, derivedTruth, failure, immutableContract, isNonNegativeSafeInteger, isPositiveSafeInteger, nonEmpty } from './internal.js';
import { normalizeOutcomePolicy } from './policy.js';

function validNullableNumber(value: unknown): boolean {
  return value === null || typeof value === 'number' && Number.isFinite(value);
}

export function validateOutcomeLabel(label: unknown): ValidationResult<AttributedOutcomeLabel> {
  const secret = validateNoSecretFields(label, 'outcomes.label');
  if (!secret.ok) return secret as ValidationResult<AttributedOutcomeLabel>;
  if (label === null || typeof label !== 'object' || Array.isArray(label)) {
    return failure('INVALID_VALUE', 'outcomes.label', 'outcome label must be an object', null);
  }
  const value = label as Partial<AttributedOutcomeLabel>;
  if (!nonEmpty(value.id) || !nonEmpty(value.frozenRecordId) || !isPositiveSafeInteger(value.horizonMs) || !isNonNegativeSafeInteger(value.observationTimeMs)) {
    return failure('INVALID_VALUE', 'outcomes.label', 'invalid outcome identity or horizon', null);
  }
  if (!['COMPLETE', 'INCOMPLETE'].includes(String(value.state)) || !(value.laterMoved === null || typeof value.laterMoved === 'boolean')) {
    return failure('INVALID_VALUE', 'outcomes.label', 'invalid outcome state', 'state');
  }
  if (!nonEmpty(value.configurationVersion) || !nonEmpty(value.featureVersion) || !Array.isArray(value.missingFields) || value.missingFields.some((field) => !nonEmpty(field))) {
    return failure('INVALID_VALUE', 'outcomes.label', 'invalid versions or missing fields', 'missingFields');
  }
  if (!value.metrics || typeof value.metrics !== 'object') return failure('INVALID_VALUE', 'outcomes.label', 'outcome metrics are required', 'metrics');
  const metrics = value.metrics as OutcomeMetrics;
  if (
    !validNullableNumber(metrics.forwardReturnPct) || !validNullableNumber(metrics.maximumFavorableExcursionPct) ||
    !validNullableNumber(metrics.maximumAdverseExcursionPct) || !validNullableNumber(metrics.fadeFromPeakPct) ||
    !(metrics.timeToPeakMs === null || isNonNegativeSafeInteger(metrics.timeToPeakMs)) ||
    !validNullableNumber(metrics.liquiditySurvivalRatio) || !validNullableNumber(metrics.depthSurvivalRatio) ||
    !(metrics.theoreticalExecutionFeasible === null || typeof metrics.theoreticalExecutionFeasible === 'boolean')
  ) return failure('INVALID_VALUE', 'outcomes.label', 'invalid outcome metrics', 'metrics');
  if ((metrics.maximumFavorableExcursionPct ?? 0) < 0 || (metrics.maximumAdverseExcursionPct ?? 0) < 0 || (metrics.fadeFromPeakPct ?? 0) < 0 || (metrics.liquiditySurvivalRatio ?? 0) < 0 || (metrics.depthSurvivalRatio ?? 0) < 0) {
    return failure('INVALID_VALUE', 'outcomes.label', 'magnitude and survival metrics cannot be negative', 'metrics');
  }
  const expectedMissing = [
    ...(metrics.forwardReturnPct === null ? ['forwardReturnPct'] : []),
    ...(metrics.maximumFavorableExcursionPct === null ? ['maximumFavorableExcursionPct'] : []),
    ...(metrics.maximumAdverseExcursionPct === null ? ['maximumAdverseExcursionPct'] : []),
    ...(metrics.fadeFromPeakPct === null ? ['fadeFromPeakPct'] : []),
    ...(metrics.timeToPeakMs === null ? ['timeToPeakMs'] : []),
    ...(metrics.liquiditySurvivalRatio === null ? ['liquiditySurvivalRatio'] : []),
    ...(metrics.depthSurvivalRatio === null ? ['depthSurvivalRatio'] : []),
    ...(metrics.theoreticalExecutionFeasible === null ? ['theoreticalExecutionFeasible'] : []),
    ...(value.laterMoved === null ? ['laterMoved'] : []),
  ].sort(compareText);
  const declaredMissing = [...new Set(value.missingFields)].sort(compareText);
  if (declaredMissing.length !== value.missingFields.length || canonicalJson(declaredMissing) !== canonicalJson(expectedMissing)) {
    return failure('INVALID_VALUE', 'outcomes.label', 'missing fields must exactly describe null outcome values', 'missingFields');
  }
  const policy = normalizeOutcomePolicy(value.policy as AttributedOutcomeLabel['policy']);
  if (!policy.ok) return policy as ValidationResult<AttributedOutcomeLabel>;
  if (value.policy?.id !== policy.value.id || value.horizonMs !== policy.value.horizonMs) {
    return failure('INVALID_VALUE', 'outcomes.label', 'outcome policy identity or horizon is inconsistent', 'policy');
  }
  const expectedId = stableId('outcome_label', {
    frozenRecordId: value.frozenRecordId,
    configurationVersion: value.configurationVersion,
    featureVersion: value.featureVersion,
    policyId: policy.value.id,
  });
  if (value.id !== expectedId) return failure('INVALID_VALUE', 'outcomes.label', 'outcome label ID omits or conflicts with material policy', 'id', [value.id]);
  const truth = validateTruthMetadata(value.truth);
  if (!truth.ok) return truth as ValidationResult<AttributedOutcomeLabel>;
  if (truth.value.configurationVersion !== value.configurationVersion || truth.value.featureVersion !== value.featureVersion) {
    return failure('INVALID_VALUE', 'outcomes.label', 'outcome truth versions do not match label versions', 'truth');
  }
  if (truth.value.temporal.sourceEventTimeMs !== null && truth.value.temporal.sourceEventTimeMs > value.observationTimeMs) {
    return failure('NO_LOOK_AHEAD_VIOLATION', 'outcomes.label', 'outcome truth includes market data after its horizon', 'truth.temporal.sourceEventTimeMs', [value.id]);
  }
  if (declaredMissing.some((field) => !truth.value.completeness.missingFields.includes(field))) {
    return failure('INVALID_VALUE', 'outcomes.label', 'truth metadata omits declared outcome missingness', 'truth.completeness.missingFields', [value.id]);
  }
  return {
    ok: true,
    value: immutableContract({
      id: value.id,
      frozenRecordId: value.frozenRecordId,
      horizonMs: value.horizonMs,
      observationTimeMs: value.observationTimeMs,
      state: value.state,
      laterMoved: value.laterMoved,
      metrics: { ...metrics },
      missingFields: declaredMissing,
      configurationVersion: value.configurationVersion,
      featureVersion: value.featureVersion,
      policy: policy.value,
      truth: truth.value,
    } as AttributedOutcomeLabel),
  };
}

function stateTruth(
  frozenRecords: IntelligenceOutcomeState['frozenRecords'],
  labels: IntelligenceOutcomeState['labels'],
) {
  const upstreamTruth = [...frozenRecords.map((record) => record.truth), ...labels.map((label) => label.truth)];
  let receivedTimeMs = 0;
  let sourceEventTimeMs: number | null = null;
  for (const truth of upstreamTruth) {
    receivedTimeMs = Math.max(receivedTimeMs, truth.temporal.receivedTimeMs);
    const eventTimeMs = truth.temporal.sourceEventTimeMs;
    if (eventTimeMs !== null) sourceEventTimeMs = sourceEventTimeMs === null ? eventTimeMs : Math.max(sourceEventTimeMs, eventTimeMs);
  }
  const incomplete = labels.filter((label) => label.state === 'INCOMPLETE');
  const degraded = upstreamTruth.filter((truth) => truth.completeness.state !== 'COMPLETE' || truth.freshness.state !== 'FRESH');
  const missingFields = [
    ...incomplete.map((label) => `outcome:${label.id}`),
    ...degraded.flatMap((truth) => [
      ...truth.completeness.missingFields.map((field) => `upstream:${truth.authority.sourceId}:${field}`),
      ...(truth.freshness.state === 'FRESH' ? [] : [`freshness:${truth.authority.sourceId}`]),
    ]),
  ];
  return derivedTruth({
    dataset: 'outcome-state',
    producerVersion: 'outcomes-reducer-1',
    configurationVersion: 'outcomes-state-v1',
    featureVersion: null,
    receivedTimeMs,
    sourceEventTimeMs,
    maxAgeMs: sourceEventTimeMs === null ? null : Math.max(0, receivedTimeMs - sourceEventTimeMs),
    upstreamTruth,
    sourceRecordIds: [...frozenRecords.map((record) => record.id), ...labels.map((label) => label.id)],
    transform: 'outcomes.reduce.v1',
    completenessState: upstreamTruth.length === 0 ? 'UNKNOWN' : (missingFields.length === 0 ? 'COMPLETE' : 'PARTIAL'),
    observedFields: ['frozenRecords', 'labels'],
    missingFields,
    reasonCodes: [
      ...(incomplete.length === 0 ? [] : ['INCOMPLETE_OUTCOME_RETAINED']),
      ...degraded.flatMap((truth) => [
        ...truth.completeness.reasonCodes,
        ...(truth.freshness.state === 'FRESH' ? [] : [`UPSTREAM_FRESHNESS_${truth.freshness.state}`]),
      ]),
    ],
  });
}

export const EMPTY_OUTCOME_STATE: IntelligenceOutcomeState = immutableContract({
  frozenRecords: [],
  labels: [],
  truth: stateTruth([], []),
});

export function validateOutcomeState(value: unknown): ValidationResult<IntelligenceOutcomeState> {
  const secret = validateNoSecretFields(value, 'outcomes.state');
  if (!secret.ok) return secret as ValidationResult<IntelligenceOutcomeState>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return failure('INVALID_VALUE', 'outcomes.state', 'outcome state must be an object', null);
  }
  const state = value as Partial<IntelligenceOutcomeState>;
  if (!Array.isArray(state.frozenRecords) || !Array.isArray(state.labels)) {
    return failure('INVALID_VALUE', 'outcomes.state', 'outcome state arrays are required', null);
  }
  const suppliedTruth = validateTruthMetadata(state.truth);
  if (!suppliedTruth.ok) return suppliedTruth as ValidationResult<IntelligenceOutcomeState>;
  const frozenRecords: Array<IntelligenceOutcomeState['frozenRecords'][number]> = [];
  const recordIds = new Set<string>();
  for (const item of state.frozenRecords) {
    const record = validateFrozenPreEventRecord(item);
    if (!record.ok) return record as ValidationResult<IntelligenceOutcomeState>;
    if (recordIds.has(record.value.id)) return failure('DUPLICATE_EVENT', 'outcomes.state', 'duplicate frozen record ID', 'frozenRecords', [record.value.id]);
    recordIds.add(record.value.id);
    frozenRecords.push(record.value);
  }
  frozenRecords.sort((left, right) => compareText(left.id, right.id));
  const recordMap = new Map(frozenRecords.map((record) => [record.id, record]));
  const labels: AttributedOutcomeLabel[] = [];
  const labelIds = new Set<string>();
  for (const item of state.labels) {
    const label = validateOutcomeLabel(item);
    if (!label.ok) return label as ValidationResult<IntelligenceOutcomeState>;
    if (labelIds.has(label.value.id)) return failure('DUPLICATE_EVENT', 'outcomes.state', 'duplicate outcome label ID', 'labels', [label.value.id]);
    labelIds.add(label.value.id);
    const record = recordMap.get(label.value.frozenRecordId);
    if (!record) return failure('MISSING_SOURCE', 'outcomes.state', 'outcome label references an unknown frozen record', 'labels', [label.value.frozenRecordId]);
    if (record.configurationVersion !== label.value.configurationVersion || record.featureVersion !== label.value.featureVersion) {
      return failure('INVALID_VALUE', 'outcomes.state', 'outcome label versions conflict with frozen record', 'labels', [label.value.id]);
    }
    const dueAtMs = record.triggerTimeMs + label.value.horizonMs;
    if (!Number.isSafeInteger(dueAtMs) || label.value.observationTimeMs !== dueAtMs || label.value.truth.temporal.receivedTimeMs < dueAtMs) {
      return failure('HORIZON_NOT_REACHED', 'outcomes.state', 'outcome label is not horizon-gated', 'labels', [label.value.id]);
    }
    labels.push(label.value);
  }
  labels.sort((left, right) => compareText(left.id, right.id));
  return {
    ok: true,
    value: immutableContract({ frozenRecords, labels, truth: stateTruth(frozenRecords, labels) }),
  };
}

export function reduceOutcomeState(
  state: IntelligenceOutcomeState,
  event: OutcomeStateEvent,
): ValidationResult<IntelligenceOutcomeState> {
  const secret = validateNoSecretFields({ state, event }, 'outcomes.reducer');
  if (!secret.ok) return secret as ValidationResult<IntelligenceOutcomeState>;
  const current = validateOutcomeState(state);
  if (!current.ok) return current;
  const base = current.value;
  if (event.type === 'FROZEN_RECORD_ADDED') {
    const record = validateFrozenPreEventRecord(event.record);
    if (!record.ok) return record as ValidationResult<IntelligenceOutcomeState>;
    const existing = base.frozenRecords.find((item) => item.id === record.value.id);
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(record.value)) return failure('INVALID_VALUE', 'outcomes.reducer', 'conflicting frozen record with existing ID', 'record.id', [record.value.id]);
      return { ok: true, value: base };
    }
    const frozenRecords = [...base.frozenRecords, record.value].sort((a, b) => compareText(a.id, b.id));
    return {
      ok: true,
      value: immutableContract({
        frozenRecords,
        labels: base.labels,
        truth: stateTruth(frozenRecords, base.labels),
      }),
    };
  }
  if (event.type !== 'OUTCOME_LABEL_ADDED') return failure('INVALID_VARIANT', 'outcomes.reducer', 'unknown outcome state event', 'event.type');
  const label = validateOutcomeLabel(event.label);
  if (!label.ok) return label as ValidationResult<IntelligenceOutcomeState>;
  const record = base.frozenRecords.find((item) => item.id === label.value.frozenRecordId);
  if (!record) return failure('MISSING_SOURCE', 'outcomes.reducer', 'frozen record must exist before outcome attribution', 'label.frozenRecordId', [label.value.frozenRecordId]);
  if (record.configurationVersion !== label.value.configurationVersion || record.featureVersion !== label.value.featureVersion) {
    return failure('INVALID_VALUE', 'outcomes.reducer', 'outcome label versions conflict with frozen record', 'label');
  }
  const dueAtMs = record.triggerTimeMs + label.value.horizonMs;
  if (!Number.isSafeInteger(dueAtMs) || label.value.observationTimeMs !== dueAtMs || label.value.truth.temporal.receivedTimeMs < dueAtMs) {
    return failure('HORIZON_NOT_REACHED', 'outcomes.reducer', 'outcome label is not horizon-gated', 'label.observationTimeMs', [label.value.id]);
  }
  const existing = base.labels.find((item) => item.id === label.value.id);
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(label.value)) return failure('INVALID_VALUE', 'outcomes.reducer', 'conflicting outcome label with existing ID', 'label.id', [label.value.id]);
    return { ok: true, value: base };
  }
  const labels = [...base.labels, label.value].sort((a, b) => compareText(a.id, b.id));
  return {
    ok: true,
    value: immutableContract({
      frozenRecords: base.frozenRecords,
      labels,
      truth: stateTruth(base.frozenRecords, labels),
    }),
  };
}
