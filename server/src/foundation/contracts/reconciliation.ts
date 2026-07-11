/**
 * Foundation contracts — reconciliation vocabulary (WAVE 0, frozen).
 *
 * The exact status and recommendation unions from the sprint directive
 * (section 13), plus a deterministic severity law for combining per-item
 * statuses into a whole-plan status.
 *
 * LAW: recommendations are DATA ONLY. Nothing in this module (or Lane E)
 * ever executes a recommendation; execution authority lives elsewhere and
 * behind risk gates.
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 */

export const RECONCILIATION_STATUSES = [
  'EXACT',
  'PENDING',
  'PARTIAL',
  'AMBIGUOUS',
  'DIVERGED',
  'STALE',
  'UNAVAILABLE',
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export function isReconciliationStatus(value: unknown): value is ReconciliationStatus {
  return typeof value === 'string' && (RECONCILIATION_STATUSES as readonly string[]).includes(value);
}

export const RECONCILIATION_RECOMMENDATIONS = [
  'WAIT',
  'REFRESH',
  'CANCEL_REMAINDER',
  'HEDGE_RESIDUAL',
  'CLOSE_POSITION',
  'MANUAL_REVIEW',
  'NO_ACTION',
] as const;
export type ReconciliationRecommendation = (typeof RECONCILIATION_RECOMMENDATIONS)[number];

export function isReconciliationRecommendation(value: unknown): value is ReconciliationRecommendation {
  return typeof value === 'string' && (RECONCILIATION_RECOMMENDATIONS as readonly string[]).includes(value);
}

/**
 * Deterministic severity ranking, benign first. Combining statuses takes
 * the worst: one DIVERGED item makes the whole comparison DIVERGED.
 * AMBIGUOUS and DIVERGED outrank STALE/UNAVAILABLE because positive
 * evidence of disagreement is worse than missing evidence.
 */
export const RECONCILIATION_STATUS_SEVERITY: Readonly<Record<ReconciliationStatus, number>> =
  Object.freeze({
    EXACT: 0,
    PENDING: 1,
    PARTIAL: 2,
    STALE: 3,
    UNAVAILABLE: 4,
    AMBIGUOUS: 5,
    DIVERGED: 6,
  });

/**
 * Worst-of combination. Throws TypeError on an empty list or invalid
 * member — a reconciliation over nothing is not EXACT, it is a bug.
 */
export function combineReconciliationStatuses(statuses: readonly ReconciliationStatus[]): ReconciliationStatus {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    throw new TypeError('combineReconciliationStatuses: at least one status is required');
  }
  let worst: ReconciliationStatus | null = null;
  for (const s of statuses) {
    if (!isReconciliationStatus(s)) {
      throw new TypeError(`combineReconciliationStatuses: invalid status ${JSON.stringify(s)}`);
    }
    if (worst === null || RECONCILIATION_STATUS_SEVERITY[s] > RECONCILIATION_STATUS_SEVERITY[worst]) {
      worst = s;
    }
  }
  return worst as ReconciliationStatus;
}

/**
 * Conservative DEFAULT status->recommendation mapping. Lane E may emit a
 * more specific recommendation from richer evidence (e.g. PARTIAL =>
 * CANCEL_REMAINDER when the remainder is cancellable); this default never
 * recommends a capital-moving action from status alone.
 */
export function defaultRecommendationForStatus(status: ReconciliationStatus): ReconciliationRecommendation {
  if (!isReconciliationStatus(status)) {
    throw new TypeError(`defaultRecommendationForStatus: invalid status ${JSON.stringify(status)}`);
  }
  switch (status) {
    case 'EXACT':
      return 'NO_ACTION';
    case 'PENDING':
      return 'WAIT';
    case 'PARTIAL':
      return 'REFRESH';
    case 'STALE':
      return 'REFRESH';
    case 'UNAVAILABLE':
      return 'MANUAL_REVIEW';
    case 'AMBIGUOUS':
      return 'MANUAL_REVIEW';
    case 'DIVERGED':
      return 'MANUAL_REVIEW';
  }
}
