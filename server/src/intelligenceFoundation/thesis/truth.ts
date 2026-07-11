import {
  sortedUnique,
  type CompletenessState,
  type FreshnessBasis,
  type FreshnessState,
  type TruthMetadata,
} from '../contracts/index.js';

function maximum(values: readonly (number | null)[]): number | null {
  const available = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return available.length === 0 ? null : Math.max(...available);
}

function effectiveBasisTime(truth: TruthMetadata): number | null {
  if (truth.freshness.basis === 'SOURCE_EVENT_TIME') return truth.temporal.sourceEventTimeMs;
  if (truth.freshness.basis === 'SOURCE_TRANSACTION_TIME') return truth.temporal.sourceTransactionTimeMs;
  if (truth.freshness.basis === 'RECEIVE_TIME') return truth.temporal.receivedTimeMs;
  return null;
}

const freshnessSeverity: Readonly<Record<FreshnessState, number>> = {
  FRESH: 0,
  STALE: 1,
  UNKNOWN: 2,
  UNAVAILABLE: 3,
};

const completenessSeverity: Readonly<Record<CompletenessState, number>> = {
  COMPLETE: 0,
  PARTIAL: 1,
  UNKNOWN: 2,
  MISSING: 3,
};

export function derivedThesisTruth(args: {
  dataset: string;
  rulesVersion: string;
  evaluatedAtMs: number;
  maxFreshAgeMs: number;
  truths: readonly TruthMetadata[];
  recordIds: readonly string[];
  transforms: readonly string[];
  observedFields: readonly string[];
  missingFields: readonly string[];
  reasonCodes: readonly string[];
}): TruthMetadata {
  const truths = [...args.truths];
  let sourceEventTimeMs = maximum(truths.map((truth) => truth.temporal.sourceEventTimeMs));
  let sourceTransactionTimeMs = maximum(truths.map((truth) => truth.temporal.sourceTransactionTimeMs));
  let receivedTimeMs = maximum(truths.map((truth) => truth.temporal.receivedTimeMs)) ?? 0;
  const worstFreshness = truths.reduce<FreshnessState>(
    (worst, truth) => freshnessSeverity[truth.freshness.state] > freshnessSeverity[worst]
      ? truth.freshness.state
      : worst,
    truths.length === 0 ? 'UNAVAILABLE' : 'FRESH',
  );
  const timedTruths = truths
    .map((truth) => ({ truth, basisTime: effectiveBasisTime(truth) }))
    .filter((entry): entry is { truth: TruthMetadata; basisTime: number } => entry.basisTime !== null)
    .sort((left, right) => left.basisTime - right.basisTime
      || left.truth.freshness.basis.localeCompare(right.truth.freshness.basis));
  const conservativeSource: { truth: TruthMetadata; basisTime: number } | null = timedTruths.length > 0
    ? timedTruths[0]
    : null;
  let basis: FreshnessBasis = conservativeSource?.truth.freshness.basis ?? 'UNAVAILABLE';
  let basisTime: number | null = conservativeSource?.basisTime ?? null;
  const upstreamMaxAges = truths
    .map((truth) => truth.freshness.maxAgeMs)
    .filter((value): value is number => value !== null);
  const maxAgeMs = upstreamMaxAges.length === 0
    ? args.maxFreshAgeMs
    : Math.min(args.maxFreshAgeMs, ...upstreamMaxAges);

  if (worstFreshness === 'UNAVAILABLE' || worstFreshness === 'UNKNOWN' || basisTime === null) {
    basis = 'UNAVAILABLE';
    basisTime = null;
  } else if (basis === 'SOURCE_EVENT_TIME') {
    sourceEventTimeMs = basisTime;
  } else if (basis === 'SOURCE_TRANSACTION_TIME') {
    sourceTransactionTimeMs = basisTime;
  } else if (basis === 'RECEIVE_TIME') {
    receivedTimeMs = basisTime;
  }
  const ageMs = basisTime === null ? null : args.evaluatedAtMs - basisTime;
  const sourceSet = sortedUnique(truths.flatMap((truth) => [
    truth.authority.sourceId,
    ...truth.provenance.sourceSet,
  ])).slice(0, 512);
  const versions = sortedUnique(truths
    .map((truth) => truth.featureVersion)
    .filter((value): value is string => value !== null));
  const upstreamCompleteness = truths.reduce<CompletenessState>(
    (worst, truth) => completenessSeverity[truth.completeness.state] > completenessSeverity[worst]
      ? truth.completeness.state
      : worst,
    'COMPLETE',
  );
  const requestedMissingFields = sortedUnique([
    ...args.missingFields,
    ...truths.flatMap((truth) => truth.completeness.missingFields),
  ]);
  let observedFields = sortedUnique([
    ...args.observedFields,
    ...truths.flatMap((truth) => truth.completeness.observedFields),
  ]).filter((field) => !requestedMissingFields.includes(field));
  let missingFields = requestedMissingFields;
  const ownCompleteness: CompletenessState = missingFields.length === 0
    ? 'COMPLETE'
    : observedFields.length === 0
      ? 'MISSING'
      : 'PARTIAL';
  let completenessState = completenessSeverity[upstreamCompleteness] > completenessSeverity[ownCompleteness]
    ? upstreamCompleteness
    : ownCompleteness;
  if (completenessState === 'MISSING' && missingFields.length === 0) {
    missingFields = ['upstream truth'];
    observedFields = observedFields.filter((field) => field !== 'upstream truth');
  }
  if (completenessState === 'COMPLETE') missingFields = [];
  const completenessReasonCodes = sortedUnique([
    ...args.reasonCodes,
    ...truths.flatMap((truth) => truth.completeness.reasonCodes),
    ...(completenessState === 'PARTIAL' || completenessState === 'MISSING'
      ? ['UPSTREAM_TRUTH_INCOMPLETE']
      : []),
  ]);

  return {
    schemaVersion: '1',
    producerVersion: 'intelligence-thesis-1',
    configurationVersion: args.rulesVersion,
    featureVersion: versions.length === 1 ? versions[0] : null,
    authority: {
      kind: 'ENGINE_DERIVED',
      sourceId: 'market-intelligence-thesis-builder',
      dataset: args.dataset,
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: sortedUnique([
        ...args.recordIds,
        ...truths.flatMap((truth) => truth.provenance.sourceRecordIds),
      ]).slice(0, 512),
      sourceSet: sourceSet.length > 0 ? sourceSet : ['market-intelligence-thesis-builder'],
      transforms: sortedUnique([
        'deterministic-thesis-build-v1',
        ...args.transforms,
        ...truths.flatMap((truth) => truth.provenance.transforms),
      ]).slice(0, 512),
    },
    temporal: {
      sourceEventTimeMs,
      sourceTransactionTimeMs,
      receivedTimeMs,
      sequence: null,
    },
    freshness: worstFreshness === 'UNAVAILABLE'
      ? {
        basis: 'UNAVAILABLE',
        evaluatedAtMs: args.evaluatedAtMs,
        ageMs: null,
        maxAgeMs: null,
        state: 'UNAVAILABLE',
      }
      : worstFreshness === 'UNKNOWN' || basisTime === null
        ? {
          basis: 'UNAVAILABLE',
          evaluatedAtMs: args.evaluatedAtMs,
          ageMs: null,
          maxAgeMs: null,
          state: 'UNKNOWN',
        }
        : {
          basis,
          evaluatedAtMs: args.evaluatedAtMs,
          ageMs,
          maxAgeMs,
          state: worstFreshness === 'STALE' || (ageMs as number) > maxAgeMs ? 'STALE' : 'FRESH',
        },
    completeness: {
      state: completenessState,
      observedFields,
      missingFields,
      reasonCodes: completenessReasonCodes,
    },
  };
}
