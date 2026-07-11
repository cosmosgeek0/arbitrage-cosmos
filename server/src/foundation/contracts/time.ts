/**
 * Foundation contracts — sourced time and freshness (WAVE 0, frozen).
 *
 * Every time-sensitive fact preserves, side by side:
 *   - the source/exchange observation time (when the venue supplied one);
 *   - the local receipt time (when WE first saw it);
 *   - the maximum acceptable age;
 *   - the data authority;
 *   - the completeness/availability state;
 *   - the source identity.
 *
 * LAW: local refresh time never overwrites source event time. Freshness is
 * judged against the source event time when it exists, and only falls back
 * to receipt time when the venue supplied none.
 *
 * LAW: no wall clock in here. Freshness is evaluated against an explicit
 * `nowMs` from the caller's injected clock (real, replay-virtual, or test).
 *
 * Pure module: no I/O, no Date.now(), no env, no import-time side effects.
 */
import {
  downgradeAuthority,
  isDataAuthority,
  type DataAuthority,
  type FreshnessState,
} from './authority.js';
import type { ValidationIssue } from './failures.js';

// ---------- UTC millisecond validation ----------

export const MIN_UTC_MS = 0;
/** 2100-01-01T00:00:00Z — anything beyond this is a malformed timestamp. */
export const MAX_UTC_MS = 4_102_444_800_000;

/** Rejects NaN, Infinity, negatives, floats, and out-of-range values. */
export function isValidUtcMillis(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= MIN_UTC_MS &&
    value <= MAX_UTC_MS
  );
}

// ---------- completeness ----------

export const COMPLETENESS_STATES = ['COMPLETE', 'PARTIAL', 'UNAVAILABLE'] as const;
export type Completeness = (typeof COMPLETENESS_STATES)[number];

export function isCompleteness(value: unknown): value is Completeness {
  return typeof value === 'string' && (COMPLETENESS_STATES as readonly string[]).includes(value);
}

// ---------- sourced timestamp ----------

export interface SourcedTimestamp {
  /**
   * Source/exchange event time (UTC ms) when the venue supplied one; null
   * when genuinely unknown. NEVER backfilled with the receipt time.
   */
  sourceTimeMs: number | null;
  /** Local receipt time (UTC ms) from the caller's injected clock. */
  receivedAtMs: number;
  /** Maximum acceptable age (ms, > 0) before this fact stops being usable. */
  maxAgeMs: number;
  authority: DataAuthority;
  completeness: Completeness;
  /** Source identity, e.g. 'binance.usdm.bookTicker'. */
  sourceId: string;
}

/** Structural validation. Empty array = valid. Never throws. */
export function validateSourcedTimestamp(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ path: '', code: 'OBJECT_REQUIRED', message: 'sourced timestamp must be a plain object' }];
  }
  const rec = input as Record<string, unknown>;
  if (rec.sourceTimeMs !== null && !isValidUtcMillis(rec.sourceTimeMs)) {
    issues.push({
      path: 'sourceTimeMs',
      code: 'UTC_MILLIS_INVALID',
      message: 'sourceTimeMs must be null or a safe-integer UTC ms in range',
    });
  }
  if (!isValidUtcMillis(rec.receivedAtMs)) {
    issues.push({
      path: 'receivedAtMs',
      code: 'UTC_MILLIS_INVALID',
      message: 'receivedAtMs must be a safe-integer UTC ms in range',
    });
  }
  if (typeof rec.maxAgeMs !== 'number' || !Number.isSafeInteger(rec.maxAgeMs) || rec.maxAgeMs <= 0) {
    issues.push({
      path: 'maxAgeMs',
      code: 'POSITIVE_INTEGER_REQUIRED',
      message: 'maxAgeMs must be a positive safe integer',
    });
  }
  if (!isDataAuthority(rec.authority)) {
    issues.push({ path: 'authority', code: 'AUTHORITY_INVALID', message: 'authority must be a DataAuthority' });
  }
  if (!isCompleteness(rec.completeness)) {
    issues.push({ path: 'completeness', code: 'COMPLETENESS_INVALID', message: 'completeness must be a Completeness state' });
  }
  if (typeof rec.sourceId !== 'string' || rec.sourceId.trim().length === 0 || rec.sourceId.length > 200) {
    issues.push({ path: 'sourceId', code: 'NON_EMPTY_STRING_REQUIRED', message: 'sourceId must be a non-empty string (<=200 chars)' });
  }
  return issues;
}

/**
 * Constructor: validates and freezes. Throws TypeError listing every issue
 * on malformed input — a bad timestamp must never enter the system quietly.
 */
export function createSourcedTimestamp(input: SourcedTimestamp): Readonly<SourcedTimestamp> {
  const issues = validateSourcedTimestamp(input);
  if (issues.length > 0) {
    throw new TypeError(
      `createSourcedTimestamp: invalid input — ${issues.map((i) => `${i.path}:${i.code}`).join(', ')}`,
    );
  }
  return Object.freeze({
    sourceTimeMs: input.sourceTimeMs,
    receivedAtMs: input.receivedAtMs,
    maxAgeMs: input.maxAgeMs,
    authority: input.authority,
    completeness: input.completeness,
    sourceId: input.sourceId,
  });
}

// ---------- freshness evaluation ----------

/**
 * How far the evaluation clock may sit BEHIND the fact's own time before we
 * call the pair clock-skewed instead of merely "very fresh".
 */
export const DEFAULT_CLOCK_SKEW_TOLERANCE_MS = 2_000;

export type FreshnessBasis = 'SOURCE_TIME' | 'RECEIPT_TIME' | 'NONE';

export interface FreshnessReport {
  state: FreshnessState;
  /** nowMs minus the basis time; null when no basis exists (UNAVAILABLE). */
  ageMs: number | null;
  /** Which time the age was computed from. Source time always wins if present. */
  basis: FreshnessBasis;
  /** Authority after applying the downgrade law (non-fresh => UNAVAILABLE). */
  effectiveAuthority: DataAuthority;
  /** The injected clock value the report was computed against. */
  evaluatedAt: number;
}

/**
 * Evaluate a fact's freshness against an INJECTED clock. Deterministic:
 * same (timestamp, nowMs, tolerance) always yields the same report.
 *
 *   - completeness/authority UNAVAILABLE  => state UNAVAILABLE, age null.
 *   - basis = sourceTimeMs when present, else receivedAtMs.
 *   - age < -tolerance                    => CLOCK_SKEWED (fact from the future).
 *   - age <= maxAgeMs                     => FRESH.
 *   - otherwise                           => STALE.
 *
 * effectiveAuthority applies the downgrade law from authority.ts; an
 * UNAVAILABLE fact can never re-emerge as anything stronger.
 */
export function evaluateFreshness(
  timestamp: SourcedTimestamp,
  nowMs: number,
  skewToleranceMs: number = DEFAULT_CLOCK_SKEW_TOLERANCE_MS,
): Readonly<FreshnessReport> {
  const issues = validateSourcedTimestamp(timestamp);
  if (issues.length > 0) {
    throw new TypeError(
      `evaluateFreshness: invalid timestamp — ${issues.map((i) => `${i.path}:${i.code}`).join(', ')}`,
    );
  }
  if (!isValidUtcMillis(nowMs)) {
    throw new TypeError('evaluateFreshness: nowMs must be a safe-integer UTC ms from an injected clock');
  }
  if (typeof skewToleranceMs !== 'number' || !Number.isSafeInteger(skewToleranceMs) || skewToleranceMs < 0) {
    throw new TypeError('evaluateFreshness: skewToleranceMs must be a non-negative safe integer');
  }

  if (timestamp.completeness === 'UNAVAILABLE' || timestamp.authority === 'UNAVAILABLE') {
    return Object.freeze({
      state: 'UNAVAILABLE' as const,
      ageMs: null,
      basis: 'NONE' as const,
      effectiveAuthority: 'UNAVAILABLE' as const,
      evaluatedAt: nowMs,
    });
  }

  const usingSource = timestamp.sourceTimeMs !== null;
  const basisTime = usingSource ? (timestamp.sourceTimeMs as number) : timestamp.receivedAtMs;
  const ageMs = nowMs - basisTime;

  let state: FreshnessState;
  if (ageMs < -skewToleranceMs) {
    state = 'CLOCK_SKEWED';
  } else if (ageMs <= timestamp.maxAgeMs) {
    state = 'FRESH';
  } else {
    state = 'STALE';
  }

  return Object.freeze({
    state,
    ageMs,
    basis: usingSource ? ('SOURCE_TIME' as const) : ('RECEIPT_TIME' as const),
    effectiveAuthority: downgradeAuthority(timestamp.authority, state),
    evaluatedAt: nowMs,
  });
}
