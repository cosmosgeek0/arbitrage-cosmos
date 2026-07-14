import {
  createSourcedTimestamp,
  evaluateFreshness,
  isCompleteness,
  isDataAuthority,
  isValidUtcMillis,
  type Completeness,
  type DataAuthority,
  type FreshnessReport,
} from '../../../foundation/contracts/index.js';

import {
  PRIVATE_DATA_BOUNDS,
  privateBoolean,
  privateInteger,
  privateRecord,
  privateSortedUnique,
  snapshotPrivateData,
} from './bounds.js';
import {
  L05_BINANCE_MATRIX_SHA256,
  PRIVATE_FACT_CONTRACT_POLICY,
  resolvePrivateFactContract,
} from './contracts.js';
import type { PrivateReadState } from './types.js';

export const L05_PRIVATE_FUTURE_SKEW_MS = 2_000;

export interface PrivateFactFreshnessInput {
  readonly readState: PrivateReadState;
  readonly authority: DataAuthority;
  readonly completeness: Completeness;
  readonly sourceId: string;
  readonly sourceTimeMs: number | null;
  readonly receivedAtMs: number;
  readonly maxAgeMs: number;
  /**
   * Some current private responses do not carry an exchange timestamp. The
   * product normalizer must opt those exact contracts into receipt fallback;
   * absence of source time is otherwise blocking.
   */
  readonly receiptTimeFallbackAllowed: boolean;
}

export interface PrivateFactFreshnessEvaluation {
  readonly freshness: Readonly<FreshnessReport>;
  readonly validUntilMs: number | null;
  readonly usableAsPrivateEvidence: boolean;
  readonly reasonCodes: readonly string[];
}

const INPUT_FIELDS = Object.freeze([
  'readState',
  'authority',
  'completeness',
  'sourceId',
  'sourceTimeMs',
  'receivedAtMs',
  'maxAgeMs',
  'receiptTimeFallbackAllowed',
] as const);

const PRIVATE_EVIDENCE_AUTHORITIES = Object.freeze([
  'LIVE_PRIVATE',
  'RECORDED_REPLAY',
  'SYNTHETIC_TEST',
] as const satisfies readonly DataAuthority[]);

const READ_STATES = Object.freeze([
  'OK',
  'RATE_LIMITED',
  'SOURCE_ERROR',
  'UNAVAILABLE',
] as const satisfies readonly PrivateReadState[]);

const L05_PRIVATE_GAP_SOURCE_ID = 'L02-BINANCE-2026-07-12';

/**
 * Direct freshness evaluation is deliberately closed to the documentary
 * sources selected for L05 private facts. The product normalizer applies the
 * stronger fact-kind-to-contract binding; this boundary prevents an arbitrary
 * opaque string from being retained even when called on its own.
 */
const PRIVATE_FACT_SOURCE_IDS = Object.freeze([
  ...new Set([
    L05_PRIVATE_GAP_SOURCE_ID,
    ...Object.values(PRIVATE_FACT_CONTRACT_POLICY).flatMap((policy) => {
      if (policy.contractId === null) return [];
      const resolution = resolvePrivateFactContract(
        policy.factKind,
        L05_BINANCE_MATRIX_SHA256,
        policy.contractId,
      );
      return resolution.contract?.sourceIds ?? [];
    }),
  ]),
].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));

function nullableUtcMillis(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!isValidUtcMillis(value)) throw new TypeError(`${label} must be null or valid UTC milliseconds`);
  return value;
}

function sourceIdentifier(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200
    || value.trim() !== value
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)
    || !PRIVATE_FACT_SOURCE_IDS.includes(value)) {
    throw new TypeError('private freshness sourceId must be an exact selected L05 documentary source');
  }
  return value;
}

function checkedValidUntil(basisMs: number, maxAgeMs: number): number {
  const validUntilMs = basisMs + maxAgeMs;
  if (!Number.isSafeInteger(validUntilMs) || !isValidUtcMillis(validUntilMs)) {
    throw new RangeError('private freshness validity boundary is outside valid UTC milliseconds');
  }
  return validUntilMs;
}

/**
 * Compare two already-validated UTC millisecond values without adding the
 * tolerance to either timestamp. Keeping the operation as a bounded
 * subtraction avoids a rollover at the UTC contract ceiling.
 */
function exceedsCausalTolerance(
  laterMs: number,
  earlierMs: number,
  toleranceMs: number,
): boolean {
  if (laterMs <= earlierMs) return false;
  const separationMs = laterMs - earlierMs;
  if (!Number.isSafeInteger(separationMs)) {
    throw new RangeError('private freshness causal separation is outside the safe-integer range');
  }
  return separationMs > toleranceMs;
}

/**
 * Apply the Foundation sourced-time law to one already-injected private fact.
 * The function owns no clock and cannot make a read, retry, or lifecycle
 * decision. Source time wins; receipt fallback is an exact caller policy.
 */
export function evaluatePrivateFactFreshness(
  input: PrivateFactFreshnessInput,
  evaluatedAtMs: number,
): Readonly<PrivateFactFreshnessEvaluation> {
  const snapshot = snapshotPrivateData(input);
  const record = privateRecord(snapshot, INPUT_FIELDS, 'private fact freshness input');
  if (!READ_STATES.includes(record.readState as PrivateReadState)) {
    throw new TypeError('private fact freshness readState is unsupported');
  }
  if (!isDataAuthority(record.authority)) throw new TypeError('private fact freshness authority is invalid');
  if (!isCompleteness(record.completeness)) throw new TypeError('private fact freshness completeness is invalid');
  const sourceId = sourceIdentifier(record.sourceId);
  const sourceTimeMs = nullableUtcMillis(record.sourceTimeMs, 'private fact sourceTimeMs');
  if (!isValidUtcMillis(record.receivedAtMs)) throw new TypeError('private fact receivedAtMs must be valid UTC milliseconds');
  if (!isValidUtcMillis(evaluatedAtMs)) throw new TypeError('private fact evaluatedAtMs must be valid UTC milliseconds');
  const maxAgeMs = privateInteger(
    record.maxAgeMs,
    'private fact maxAgeMs',
    1,
    PRIVATE_DATA_BOUNDS.maximumFactAgeMs,
  );
  // This is a closed evidence policy, not a caller-selected clock tolerance.
  // Keeping the constant inside the evaluator prevents a consumer from making
  // causally divergent source/receipt clocks usable by widening the boundary.
  const futureSkewMs = L05_PRIVATE_FUTURE_SKEW_MS;
  const fallbackAllowed = privateBoolean(
    record.receiptTimeFallbackAllowed,
    'private fact receiptTimeFallbackAllowed',
  );
  const reasons: string[] = [];

  // A fact cannot be evidence at a cut that predates its local receipt. This
  // is stricter than clock-skew freshness: no tolerance can make information
  // available before it was observed by the local process.
  if ((record.receivedAtMs as number) > evaluatedAtMs) {
    reasons.push('PRIVATE_RECEIPT_AFTER_EVALUATION');
  }

  // Preserve both clocks and fail closed when they do not describe one
  // plausible causal observation. Freshness age below still uses source time
  // whenever present; these checks only decide whether that age is admissible
  // as private evidence.
  if (sourceTimeMs !== null) {
    if (exceedsCausalTolerance(sourceTimeMs, record.receivedAtMs as number, futureSkewMs)) {
      reasons.push('PRIVATE_SOURCE_AFTER_RECEIPT_CLOCK_SKEWED');
    }
    if (exceedsCausalTolerance(record.receivedAtMs as number, sourceTimeMs, futureSkewMs)) {
      reasons.push('PRIVATE_RECEIPT_AFTER_SOURCE_CLOCK_SKEWED');
    }
  }

  if (sourceId === L05_PRIVATE_GAP_SOURCE_ID) reasons.push('PRIVATE_CONTRACT_GAP');

  if (record.readState === 'RATE_LIMITED') reasons.push('PRIVATE_SOURCE_RATE_LIMITED');
  else if (record.readState === 'SOURCE_ERROR') reasons.push('PRIVATE_SOURCE_ERROR');
  else if (record.readState === 'UNAVAILABLE') reasons.push('PRIVATE_SOURCE_UNAVAILABLE');

  if (!PRIVATE_EVIDENCE_AUTHORITIES.includes(record.authority as (typeof PRIVATE_EVIDENCE_AUTHORITIES)[number])) {
    reasons.push('PRIVATE_AUTHORITY_REQUIRED');
  }
  if (record.completeness === 'PARTIAL') reasons.push('PRIVATE_SOURCE_PARTIAL');
  else if (record.completeness === 'UNAVAILABLE') reasons.push('PRIVATE_SOURCE_UNAVAILABLE');

  const temporalEvidenceAvailable = record.readState === 'OK'
    && record.authority !== 'UNAVAILABLE'
    && record.completeness !== 'UNAVAILABLE';
  const sourceTimeRequired = temporalEvidenceAvailable && sourceTimeMs === null && !fallbackAllowed;
  if (sourceTimeRequired) reasons.push('PRIVATE_SOURCE_TIME_REQUIRED');
  else if (temporalEvidenceAvailable && sourceTimeMs === null) reasons.push('PRIVATE_RECEIPT_TIME_FALLBACK');

  const timestamp = createSourcedTimestamp({
    sourceTimeMs,
    receivedAtMs: record.receivedAtMs as number,
    maxAgeMs,
    authority: sourceTimeRequired ? 'UNAVAILABLE' : record.authority as DataAuthority,
    completeness: sourceTimeRequired ? 'UNAVAILABLE' : record.completeness as Completeness,
    sourceId,
  });
  const freshness = evaluateFreshness(timestamp, evaluatedAtMs, futureSkewMs);
  if (freshness.state === 'STALE') reasons.push('PRIVATE_SOURCE_STALE');
  else if (freshness.state === 'CLOCK_SKEWED') reasons.push('PRIVATE_SOURCE_CLOCK_SKEWED');
  else if (freshness.state === 'UNAVAILABLE') reasons.push('PRIVATE_SOURCE_UNAVAILABLE');

  const validUntilMs = !temporalEvidenceAvailable || sourceTimeRequired
    ? null
    : checkedValidUntil(sourceTimeMs ?? record.receivedAtMs as number, maxAgeMs);
  const reasonCodes = privateSortedUnique(reasons);
  return Object.freeze({
    freshness,
    validUntilMs,
    usableAsPrivateEvidence: record.readState === 'OK'
      && record.completeness === 'COMPLETE'
      && PRIVATE_EVIDENCE_AUTHORITIES.includes(record.authority as (typeof PRIVATE_EVIDENCE_AUTHORITIES)[number])
      && freshness.state === 'FRESH'
      && sourceId !== L05_PRIVATE_GAP_SOURCE_ID
      && reasonCodes.every((reason) => reason === 'PRIVATE_RECEIPT_TIME_FALLBACK'),
    reasonCodes,
  });
}
