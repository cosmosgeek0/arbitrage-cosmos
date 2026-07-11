import {
  canonicalJson,
  makeStableFailure,
  sortedUnique,
  validateTruthMetadata,
  type CompletenessState,
  type StableFailure,
  type TruthMetadata,
  type ValidationResult,
} from '../contracts/index.js';

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function failure(
  code: StableFailure['code'],
  component: string,
  message: string,
  field: string | null,
  evidenceIds: readonly string[] = [],
): ValidationResult<never> {
  return { ok: false, failure: makeStableFailure(code, component, message, field, [...evidenceIds]) };
}

function cloneContract<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function freezeRecursive(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value as Record<string, unknown>)) freezeRecursive(child);
  Object.freeze(value);
}

/** Canonically clones contract data before recursively freezing it. */
export function immutableContract<T>(value: T): T {
  const clone = cloneContract(value);
  freezeRecursive(clone);
  return clone;
}

/** Re-evaluates declared freshness at an injected boundary without changing source timestamps. */
export function reAgeTruth(value: TruthMetadata, evaluatedAtMs: number): ValidationResult<TruthMetadata> {
  if (!isNonNegativeSafeInteger(evaluatedAtMs)) {
    return failure('INVALID_VALUE', 'outcomes.freshness', 'freshness boundary must be a non-negative safe integer', 'evaluatedAtMs');
  }
  const validated = validateTruthMetadata(value);
  if (!validated.ok) return validated;
  const truth = validated.value;
  if (truth.temporal.receivedTimeMs > evaluatedAtMs) {
    return failure('NO_LOOK_AHEAD_VIOLATION', 'outcomes.freshness', 'evidence was received after its evaluation boundary', 'temporal.receivedTimeMs', truth.provenance.sourceRecordIds);
  }
  const basisTimeMs = truth.freshness.basis === 'SOURCE_EVENT_TIME'
    ? truth.temporal.sourceEventTimeMs
    : truth.freshness.basis === 'SOURCE_TRANSACTION_TIME'
      ? truth.temporal.sourceTransactionTimeMs
      : truth.freshness.basis === 'RECEIVE_TIME'
        ? truth.temporal.receivedTimeMs
        : null;
  if (basisTimeMs !== null && basisTimeMs > evaluatedAtMs) {
    return failure('NO_LOOK_AHEAD_VIOLATION', 'outcomes.freshness', 'freshness basis follows its evaluation boundary', 'freshness', truth.provenance.sourceRecordIds);
  }
  const freshness = basisTimeMs === null || truth.freshness.basis === 'UNAVAILABLE'
    ? {
        basis: 'UNAVAILABLE' as const,
        evaluatedAtMs,
        ageMs: null,
        maxAgeMs: null,
        state: 'UNAVAILABLE' as const,
      }
    : truth.freshness.maxAgeMs === null
      ? {
          basis: truth.freshness.basis,
          evaluatedAtMs,
          ageMs: evaluatedAtMs - basisTimeMs,
          maxAgeMs: null,
          state: 'UNKNOWN' as const,
        }
      : {
          basis: truth.freshness.basis,
          evaluatedAtMs,
          ageMs: evaluatedAtMs - basisTimeMs,
          maxAgeMs: truth.freshness.maxAgeMs,
          state: evaluatedAtMs - basisTimeMs <= truth.freshness.maxAgeMs ? 'FRESH' as const : 'STALE' as const,
        };
  const reAged = validateTruthMetadata({ ...truth, freshness });
  if (!reAged.ok) return reAged;
  return { ok: true, value: reAged.value };
}

export interface DerivedTruthInput {
  dataset: string;
  producerVersion: string;
  configurationVersion: string;
  featureVersion: string | null;
  receivedTimeMs: number;
  sourceEventTimeMs: number | null;
  maxAgeMs: number | null;
  upstreamTruth: readonly TruthMetadata[];
  sourceRecordIds: readonly string[];
  transform: string;
  completenessState: CompletenessState;
  observedFields: readonly string[];
  missingFields: readonly string[];
  reasonCodes: readonly string[];
}

export function derivedTruth(input: DerivedTruthInput): TruthMetadata {
  const sourceSet = sortedUnique(input.upstreamTruth.flatMap((truth) => truth.provenance.sourceSet));
  if (sourceSet.length === 0) sourceSet.push('intelligence-foundation');
  const sourceEventTimeMs = input.sourceEventTimeMs;
  const freshness = sourceEventTimeMs === null || input.maxAgeMs === null
    ? {
        basis: 'UNAVAILABLE' as const,
        evaluatedAtMs: input.receivedTimeMs,
        ageMs: null,
        maxAgeMs: null,
        state: 'UNAVAILABLE' as const,
      }
    : {
        basis: 'SOURCE_EVENT_TIME' as const,
        evaluatedAtMs: input.receivedTimeMs,
        ageMs: input.receivedTimeMs - sourceEventTimeMs,
        maxAgeMs: input.maxAgeMs,
        state: input.receivedTimeMs - sourceEventTimeMs <= input.maxAgeMs
          ? 'FRESH' as const
          : 'STALE' as const,
      };
  const missingFields = sortedUnique(input.missingFields);
  const reasonCodes = sortedUnique(input.reasonCodes);
  if ((input.completenessState === 'PARTIAL' || input.completenessState === 'MISSING') && missingFields.length === 0) {
    missingFields.push('upstream-completeness');
  }
  if ((input.completenessState === 'PARTIAL' || input.completenessState === 'MISSING') && reasonCodes.length === 0) {
    reasonCodes.push('INCOMPLETE_UPSTREAM');
  }
  return {
    schemaVersion: '1',
    producerVersion: input.producerVersion,
    configurationVersion: input.configurationVersion,
    featureVersion: input.featureVersion,
    authority: {
      kind: 'ENGINE_DERIVED',
      sourceId: 'intelligence-outcomes',
      dataset: input.dataset,
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: sortedUnique(input.sourceRecordIds),
      sourceSet,
      transforms: sortedUnique([
        input.transform,
        ...input.upstreamTruth.flatMap((truth) => truth.provenance.transforms),
      ]),
    },
    temporal: {
      sourceEventTimeMs,
      sourceTransactionTimeMs: null,
      receivedTimeMs: input.receivedTimeMs,
      sequence: null,
    },
    freshness,
    completeness: {
      state: input.completenessState,
      observedFields: sortedUnique(input.observedFields),
      missingFields,
      reasonCodes,
    },
  };
}

export function roundMetric(value: number): number {
  if (Object.is(value, -0)) return 0;
  return Number(value.toFixed(12));
}
