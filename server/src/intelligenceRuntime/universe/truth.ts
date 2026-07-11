import {
  sortedUnique,
  validateTruthMetadata,
  type CompletenessState,
  type SourceAuthorityKind,
  type SourceEndpointClass,
  type TruthMetadata,
} from '../../intelligenceFoundation/contracts/index.js';

export interface RuntimeTruthInput {
  configurationVersion: string;
  sourceId: string;
  dataset: string;
  endpointClass: SourceEndpointClass;
  authorityKind: SourceAuthorityKind;
  evaluatedAtMs: number;
  receivedTimeMs: number;
  maxAgeMs: number | null;
  sourceRecordIds?: readonly string[];
  sourceSet?: readonly string[];
  transforms: readonly string[];
  completeness: CompletenessState;
  observedFields: readonly string[];
  missingFields?: readonly string[];
  reasonCodes?: readonly string[];
}

function requiredTruth(value: TruthMetadata): TruthMetadata {
  const validated = validateTruthMetadata(value);
  if (!validated.ok) throw new TypeError(`runtime universe produced invalid truth: ${validated.failure.message}`);
  return validated.value;
}

export function runtimeUniverseTruth(input: RuntimeTruthInput): TruthMetadata {
  const maxAgeMs = input.maxAgeMs;
  const unavailable = maxAgeMs === null;
  const ageMs = unavailable ? null : input.evaluatedAtMs - input.receivedTimeMs;
  const freshness = unavailable
    ? {
      basis: 'UNAVAILABLE' as const,
      evaluatedAtMs: input.evaluatedAtMs,
      ageMs: null,
      maxAgeMs: null,
      state: 'UNAVAILABLE' as const,
    }
    : {
      basis: 'RECEIVE_TIME' as const,
      evaluatedAtMs: input.evaluatedAtMs,
      ageMs,
      maxAgeMs,
      state: (ageMs as number) > maxAgeMs ? 'STALE' as const : 'FRESH' as const,
    };
  const missingFields = sortedUnique(input.missingFields ?? []);
  const reasonCodes = sortedUnique(input.reasonCodes ?? []);
  return requiredTruth({
    schemaVersion: '1',
    producerVersion: 'live-intelligence-universe-1',
    configurationVersion: input.configurationVersion,
    featureVersion: null,
    authority: {
      kind: input.authorityKind,
      sourceId: input.sourceId,
      dataset: input.dataset,
      endpointClass: input.endpointClass,
    },
    provenance: {
      sourceRecordIds: sortedUnique(input.sourceRecordIds ?? []),
      sourceSet: sortedUnique([input.sourceId, ...(input.sourceSet ?? [])]),
      transforms: sortedUnique(input.transforms),
    },
    temporal: {
      sourceEventTimeMs: null,
      sourceTransactionTimeMs: null,
      receivedTimeMs: input.receivedTimeMs,
      sequence: null,
    },
    freshness,
    completeness: {
      state: input.completeness,
      observedFields: sortedUnique(input.observedFields),
      missingFields,
      reasonCodes,
    },
  });
}

export function reAgeRuntimeUniverseTruth(
  truth: TruthMetadata,
  evaluatedAtMs: number,
  maxAgeMs: number,
): TruthMetadata {
  return runtimeUniverseTruth({
    sourceId: truth.authority.sourceId,
    configurationVersion: truth.configurationVersion,
    dataset: truth.authority.dataset,
    endpointClass: truth.authority.endpointClass,
    authorityKind: truth.authority.kind,
    evaluatedAtMs,
    receivedTimeMs: truth.temporal.receivedTimeMs,
    maxAgeMs,
    sourceRecordIds: truth.provenance.sourceRecordIds,
    sourceSet: truth.provenance.sourceSet,
    transforms: truth.provenance.transforms,
    completeness: truth.completeness.state,
    observedFields: truth.completeness.observedFields,
    missingFields: truth.completeness.missingFields,
    reasonCodes: truth.completeness.reasonCodes,
  });
}

export function unavailableUniverseTruth(input: {
  configurationVersion: string;
  sourceId: string;
  dataset: string;
  evaluatedAtMs: number;
  missingField: string;
  reasonCode: string;
}): TruthMetadata {
  return runtimeUniverseTruth({
    configurationVersion: input.configurationVersion,
    sourceId: input.sourceId,
    dataset: input.dataset,
    endpointClass: 'INJECTED',
    authorityKind: 'UNKNOWN',
    evaluatedAtMs: input.evaluatedAtMs,
    receivedTimeMs: input.evaluatedAtMs,
    maxAgeMs: null,
    transforms: ['declare-runtime-source-unavailable-v1'],
    completeness: 'MISSING',
    observedFields: [],
    missingFields: [input.missingField],
    reasonCodes: [input.reasonCode],
  });
}
