import {
  sortedUnique,
  stableSetId,
  type FeatureValue,
  type NormalizedEvidence,
  type TruthMetadata,
} from '../contracts/index.js';
import type { FeatureBankConfig } from './config.js';

export function evidenceTime(evidence: NormalizedEvidence): number {
  return evidence.truth.temporal.sourceTransactionTimeMs
    ?? evidence.truth.temporal.sourceEventTimeMs
    ?? evidence.truth.temporal.receivedTimeMs;
}

export function isUsableEvidenceTruth(evidence: NormalizedEvidence): boolean {
  return evidence.truth.authority.kind !== 'UNKNOWN' &&
    evidence.truth.freshness.state === 'FRESH' &&
    evidence.truth.completeness.state === 'COMPLETE';
}

export function sourceSetOf(evidence: readonly NormalizedEvidence[]): string[] {
  return sortedUnique(evidence.flatMap((record) => [
    record.truth.authority.sourceId,
    ...record.truth.provenance.sourceSet,
  ]));
}

function maximum(values: readonly (number | null)[]): number | null {
  let output: number | null = null;
  for (const value of values) {
    if (value !== null && Number.isFinite(value) && (output === null || value > output)) output = value;
  }
  return output;
}

export function derivedTruth(args: {
  config: FeatureBankConfig;
  dataset: string;
  evaluatedAtMs: number;
  evidence: readonly NormalizedEvidence[];
  maxAgeMs: number;
  completeness: TruthMetadata['completeness'];
  transforms: readonly string[];
}): TruthMetadata {
  const usableEvidence = args.evidence.filter(isUsableEvidenceTruth);
  const hasUnusableEvidence = usableEvidence.length !== args.evidence.length;
  const boundedEvidence = [...new Map(args.evidence.map((record) => [record.id, record] as const)).values()]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .slice(0, args.config.maxProvenanceIds);
  const eventTime = maximum(usableEvidence.map((record) => record.truth.temporal.sourceEventTimeMs));
  const transactionTime = maximum(usableEvidence.map((record) => record.truth.temporal.sourceTransactionTimeMs));
  const receivedTime = maximum(args.evidence.map((record) => record.truth.temporal.receivedTimeMs)) ?? 0;
  const basis = eventTime !== null
    ? 'SOURCE_EVENT_TIME'
    : transactionTime !== null
      ? 'SOURCE_TRANSACTION_TIME'
      : usableEvidence.length > 0
        ? 'RECEIVE_TIME'
        : 'UNAVAILABLE';
  const basisTime = basis === 'SOURCE_EVENT_TIME'
    ? eventTime
    : basis === 'SOURCE_TRANSACTION_TIME'
      ? transactionTime
      : basis === 'RECEIVE_TIME'
        ? receivedTime
        : null;
  const ageMs = basisTime === null ? null : args.evaluatedAtMs - basisTime;
  const sourceSet = sourceSetOf(args.evidence);
  const effectiveMissingFields = sortedUnique([
    ...args.completeness.missingFields,
    ...(hasUnusableEvidence ? ['usableUpstreamTruth'] : []),
  ]);
  const effectiveReasonCodes = sortedUnique([
    ...args.completeness.reasonCodes,
    ...(hasUnusableEvidence ? ['UPSTREAM_TRUTH_UNUSABLE'] : []),
  ]);
  const effectiveCompletenessState = usableEvidence.length === 0 && args.evidence.length > 0
    ? 'MISSING'
    : hasUnusableEvidence && args.completeness.state === 'COMPLETE'
      ? 'PARTIAL'
      : args.completeness.state;
  if (effectiveCompletenessState !== 'COMPLETE' && effectiveMissingFields.length === 0) {
    effectiveMissingFields.push('completeFeatureInputs');
  }
  if (effectiveCompletenessState !== 'COMPLETE' && effectiveReasonCodes.length === 0) {
    effectiveReasonCodes.push('FEATURE_INPUT_INCOMPLETE');
  }
  return {
    schemaVersion: args.config.schemaVersion,
    producerVersion: args.config.producerVersion,
    configurationVersion: args.config.configurationVersion,
    featureVersion: args.config.featureVersion,
    authority: {
      kind: 'ENGINE_DERIVED',
      sourceId: 'market-intelligence-feature-bank',
      dataset: args.dataset,
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: boundedEvidence.map((record) => record.id),
      sourceSet: sourceSet.length > 0 ? sourceSet : ['market-intelligence-feature-bank'],
      transforms: sortedUnique(['bounded-feature-bank-v1', ...args.transforms]),
    },
    temporal: {
      sourceEventTimeMs: eventTime,
      sourceTransactionTimeMs: transactionTime,
      receivedTimeMs: receivedTime,
      sequence: null,
    },
    freshness: basisTime === null
      ? {
        basis: 'UNAVAILABLE',
        evaluatedAtMs: args.evaluatedAtMs,
        ageMs: null,
        maxAgeMs: null,
        state: 'UNAVAILABLE',
      }
      : {
        basis,
        evaluatedAtMs: args.evaluatedAtMs,
        ageMs,
        maxAgeMs: args.maxAgeMs,
        state: (ageMs as number) <= args.maxAgeMs ? 'FRESH' : 'STALE',
      },
    completeness: {
      state: effectiveCompletenessState,
      observedFields: sortedUnique(args.completeness.observedFields),
      missingFields: effectiveMissingFields,
      reasonCodes: effectiveReasonCodes,
    },
  };
}

export function featureValue(args: {
  config: FeatureBankConfig;
  instrumentId: string;
  feature: string;
  value: FeatureValue['value'];
  unit: string;
  windowMs: number | null;
  evaluatedAtMs: number;
  evidence: readonly NormalizedEvidence[];
  maxAgeMs: number;
  reasonCodes?: readonly string[];
  missingFields?: readonly string[];
  transforms?: readonly string[];
}): FeatureValue {
  let safeValue = args.value;
  const numericOverflow = typeof safeValue === 'number' && !Number.isFinite(safeValue);
  if (numericOverflow) safeValue = null;
  let observationStartMs: number | null = null;
  let observationEndMs: number | null = null;
  for (const record of args.evidence) {
    const time = evidenceTime(record);
    if (!Number.isFinite(time)) continue;
    if (observationStartMs === null || time < observationStartMs) observationStartMs = time;
    if (observationEndMs === null || time > observationEndMs) observationEndMs = time;
  }
  const missingFields = [
    ...(args.missingFields ?? (safeValue === null ? [args.feature] : [])),
    ...(numericOverflow ? ['finiteNumericAggregation'] : []),
  ];
  const completenessState = safeValue === null
    ? args.evidence.length === 0 ? 'MISSING' : 'PARTIAL'
    : missingFields.length > 0 ? 'PARTIAL' : 'COMPLETE';
  const reasonCodes = [...(args.reasonCodes ?? [])];
  if (numericOverflow) reasonCodes.push('NUMERIC_OVERFLOW');
  if (completenessState !== 'COMPLETE' && reasonCodes.length === 0) {
    reasonCodes.push('FEATURE_INPUT_INCOMPLETE');
  }
  const truth = derivedTruth({
    config: args.config,
    dataset: args.feature,
    evaluatedAtMs: args.evaluatedAtMs,
    evidence: args.evidence,
    maxAgeMs: args.maxAgeMs,
    completeness: {
      state: completenessState,
      observedFields: safeValue === null ? [] : [args.feature],
      missingFields: [...missingFields],
      reasonCodes,
    },
    transforms: [...(args.transforms ?? []), args.feature],
  });
  return {
    id: stableSetId('feature', {
      instrumentId: args.instrumentId,
      feature: args.feature,
      featureVersion: args.config.featureVersion,
      windowMs: args.windowMs,
      observationStartMs,
      observationEndMs,
      value: safeValue,
      evidenceIds: sortedUnique(args.evidence.map((record) => record.id)).slice(0, args.config.maxProvenanceIds),
      evidenceCount: args.evidence.length,
    }, ['evidenceIds']),
    instrumentId: args.instrumentId,
    feature: args.feature,
    featureVersion: args.config.featureVersion,
    value: safeValue,
    unit: args.unit,
    windowMs: args.windowMs,
    observationStartMs,
    observationEndMs,
    truth,
  };
}
