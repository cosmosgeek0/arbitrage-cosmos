import {
  sortedUnique,
  type TruthMetadata,
} from '../contracts/index.js';
import type { ForensicsConfig } from './config.js';

function maximum(values: readonly (number | null)[]): number | null {
  let result: number | null = null;
  for (const value of values) {
    if (value !== null && Number.isFinite(value) && (result === null || value > result)) result = value;
  }
  return result;
}

export function derivedForensicsTruth(args: {
  config: Readonly<ForensicsConfig>;
  configurationVersion: string;
  featureVersion: string;
  dataset: string;
  evaluatedAtMs: number;
  truths: readonly TruthMetadata[];
  recordIds: readonly string[];
  transforms: readonly string[];
  observedFields: readonly string[];
  missingFields: readonly string[];
  reasonCodes: readonly string[];
}): TruthMetadata {
  const truths = [...args.truths];
  const sourceEventTimeMs = maximum(truths.map((truth) => truth.temporal.sourceEventTimeMs));
  const sourceTransactionTimeMs = maximum(truths.map((truth) => truth.temporal.sourceTransactionTimeMs));
  const receivedTimeMs = maximum(truths.map((truth) => truth.temporal.receivedTimeMs)) ?? 0;
  const basis = sourceEventTimeMs !== null
    ? 'SOURCE_EVENT_TIME'
    : sourceTransactionTimeMs !== null
      ? 'SOURCE_TRANSACTION_TIME'
      : truths.length > 0
        ? 'RECEIVE_TIME'
        : 'UNAVAILABLE';
  const basisTime = basis === 'SOURCE_EVENT_TIME'
    ? sourceEventTimeMs
    : basis === 'SOURCE_TRANSACTION_TIME'
      ? sourceTransactionTimeMs
      : basis === 'RECEIVE_TIME'
        ? receivedTimeMs
        : null;
  const ageMs = basisTime === null ? null : args.evaluatedAtMs - basisTime;
  const observedFields = sortedUnique(args.observedFields).slice(0, args.config.maxProvenanceIds);
  const missingFields = sortedUnique(args.missingFields)
    .filter((field) => !observedFields.includes(field))
    .slice(0, args.config.maxProvenanceIds);
  const reasonCodes = sortedUnique([
    ...args.reasonCodes,
    ...(missingFields.length > 0 && args.reasonCodes.length === 0 ? ['FORENSICS_REQUIRED_EVIDENCE_MISSING'] : []),
  ]).slice(0, args.config.maxProvenanceIds);
  const completenessState = missingFields.length === 0
    ? 'COMPLETE'
    : observedFields.length === 0
      ? 'MISSING'
      : 'PARTIAL';
  const sourceSet = sortedUnique(truths.flatMap((truth) => [
    truth.authority.sourceId,
    ...truth.provenance.sourceSet,
  ])).slice(0, args.config.maxProvenanceIds);

  return {
    schemaVersion: args.config.schemaVersion,
    producerVersion: args.config.producerVersion,
    configurationVersion: args.configurationVersion,
    featureVersion: args.featureVersion,
    authority: {
      kind: 'ENGINE_DERIVED',
      sourceId: 'market-intelligence-false-positive-forensics',
      dataset: args.dataset,
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: sortedUnique([
        ...args.recordIds,
        ...truths.flatMap((truth) => truth.provenance.sourceRecordIds),
      ]).slice(0, args.config.maxProvenanceIds),
      sourceSet: sourceSet.length > 0 ? sourceSet : ['market-intelligence-false-positive-forensics'],
      transforms: sortedUnique([
        'deterministic-false-positive-forensics-v1',
        ...args.transforms,
      ]).slice(0, args.config.maxProvenanceIds),
    },
    temporal: {
      sourceEventTimeMs,
      sourceTransactionTimeMs,
      receivedTimeMs,
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
        maxAgeMs: args.config.maxFreshAgeMs,
        state: (ageMs as number) <= args.config.maxFreshAgeMs ? 'FRESH' : 'STALE',
      },
    completeness: {
      state: completenessState,
      observedFields,
      missingFields,
      reasonCodes,
    },
  };
}
