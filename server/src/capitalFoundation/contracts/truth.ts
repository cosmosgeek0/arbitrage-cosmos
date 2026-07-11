import {
  evaluateFreshness,
  type DataAuthority,
  type FreshnessReport,
  type SourcedTimestamp,
} from '../../foundation/contracts/index.js';

export const CAPITAL_TRUTH_STATES = [
  'COMPLETE',
  'PARTIAL',
  'STALE',
  'UNKNOWN',
  'DIVERGENT',
] as const;
export type CapitalTruthState = (typeof CAPITAL_TRUTH_STATES)[number];

export interface TruthMetadata {
  readonly source: Readonly<SourcedTimestamp>;
  readonly evaluatedAtMs: number;
  readonly freshness: Readonly<FreshnessReport>;
  readonly completeness: CapitalTruthState;
  readonly reasons: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly revision: string | null;
}

export interface TruthBearing<T> {
  readonly value: T | null;
  readonly truth: Readonly<TruthMetadata>;
}

export interface AssessCapitalTruthInput {
  readonly source: SourcedTimestamp;
  readonly evaluatedAtMs: number;
  readonly reasons?: readonly string[];
  readonly evidenceReferences?: readonly string[];
  readonly revision?: string | null;
  readonly requiredValuePresent: boolean;
  readonly divergent?: boolean;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

export function assessCapitalTruth(input: AssessCapitalTruthInput): Readonly<TruthMetadata> {
  const freshness = evaluateFreshness(input.source, input.evaluatedAtMs);
  let completeness: CapitalTruthState;
  if (input.divergent === true) {
    completeness = 'DIVERGENT';
  } else if (!input.requiredValuePresent || input.source.completeness === 'UNAVAILABLE') {
    completeness = 'UNKNOWN';
  } else if (freshness.state === 'STALE') {
    completeness = 'STALE';
  } else if (freshness.state !== 'FRESH') {
    completeness = 'UNKNOWN';
  } else if (input.source.completeness === 'PARTIAL') {
    completeness = 'PARTIAL';
  } else {
    completeness = 'COMPLETE';
  }
  return Object.freeze({
    source: Object.freeze({ ...input.source }),
    evaluatedAtMs: input.evaluatedAtMs,
    freshness,
    completeness,
    reasons: sortedUnique(input.reasons ?? []),
    evidenceReferences: sortedUnique(input.evidenceReferences ?? []),
    revision: input.revision ?? null,
  });
}

export function truthAllowsNewExposure(truth: TruthMetadata): boolean {
  return truth.completeness === 'COMPLETE'
    && truth.freshness.state === 'FRESH'
    && truth.freshness.effectiveAuthority !== 'UNAVAILABLE';
}

export function weakestCapitalTruth(states: readonly CapitalTruthState[]): CapitalTruthState {
  if (states.length === 0) throw new TypeError('weakestCapitalTruth requires at least one state');
  const severity: Readonly<Record<CapitalTruthState, number>> = Object.freeze({
    COMPLETE: 0,
    PARTIAL: 1,
    STALE: 2,
    UNKNOWN: 3,
    DIVERGENT: 4,
  });
  let worst = states[0];
  for (const state of states) {
    if (!(CAPITAL_TRUTH_STATES as readonly string[]).includes(state)) {
      throw new TypeError(`unknown capital truth state ${String(state)}`);
    }
    if (severity[state] > severity[worst]) worst = state;
  }
  return worst;
}

export interface SourceIdentityReference {
  readonly sourceId: string;
  readonly authority: DataAuthority;
  readonly sourceTimestampMs: number | null;
  readonly receivedAtMs: number;
  readonly evaluatedAtMs: number;
  readonly revision: string | null;
}
