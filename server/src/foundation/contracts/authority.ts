/**
 * Foundation contracts — data authority vocabulary (WAVE 0, frozen).
 *
 * Every fact that flows through the foundation carries a DataAuthority label
 * saying HOW it was obtained. Downstream logic must never treat weaker
 * authority as stronger, and must never treat a stale fact as live.
 *
 * Also hosts the explicit unknown-value discipline: unknown facts are
 * represented as `null`, 'UNKNOWN', or 'UNAVAILABLE' — never fabricated
 * defaults. Helpers here make "is this actually known?" a single call.
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 */

export const DATA_AUTHORITIES = [
  'LIVE_PUBLIC',
  'LIVE_PRIVATE',
  'DERIVED_LIVE',
  'RECORDED_REPLAY',
  'SYNTHETIC_TEST',
  'UNAVAILABLE',
] as const;

export type DataAuthority = (typeof DATA_AUTHORITIES)[number];

export function isDataAuthority(value: unknown): value is DataAuthority {
  return typeof value === 'string' && (DATA_AUTHORITIES as readonly string[]).includes(value);
}

/** True when the fact came from (or was derived from) a live feed. */
export function isLiveAuthority(authority: DataAuthority): boolean {
  return authority === 'LIVE_PUBLIC' || authority === 'LIVE_PRIVATE' || authority === 'DERIVED_LIVE';
}

/** True when the fact required signed/private access to obtain. */
export function isPrivateAuthority(authority: DataAuthority): boolean {
  return authority === 'LIVE_PRIVATE';
}

/**
 * Deterministic strength ranking, strongest first. Used when a derived fact
 * combines several inputs: the result can never be stronger than its weakest
 * input.
 */
export const AUTHORITY_STRENGTH: Readonly<Record<DataAuthority, number>> = Object.freeze({
  LIVE_PRIVATE: 5,
  LIVE_PUBLIC: 4,
  DERIVED_LIVE: 3,
  RECORDED_REPLAY: 2,
  SYNTHETIC_TEST: 1,
  UNAVAILABLE: 0,
});

/**
 * Combine input authorities: the weakest wins. A value derived from a live
 * book and an unavailable borrow fact is, as a whole, UNAVAILABLE-grade.
 * Throws TypeError on an empty list or an invalid member (invalid variants
 * must fail, not silently pass through).
 */
export function weakestAuthority(...authorities: DataAuthority[]): DataAuthority {
  if (authorities.length === 0) {
    throw new TypeError('weakestAuthority: at least one authority is required');
  }
  let weakest: DataAuthority | null = null;
  for (const a of authorities) {
    if (!isDataAuthority(a)) {
      throw new TypeError(`weakestAuthority: invalid authority ${JSON.stringify(a)}`);
    }
    if (weakest === null || AUTHORITY_STRENGTH[a] < AUTHORITY_STRENGTH[weakest]) {
      weakest = a;
    }
  }
  return weakest as DataAuthority;
}

// ---------- freshness-driven downgrade law ----------

/**
 * Freshness verdict vocabulary. Lives here (not time.ts) because the
 * authority downgrade law is defined over it; time.ts re-exports it via the
 * barrel for callers evaluating freshness.
 */
export const FRESHNESS_STATES = ['FRESH', 'STALE', 'UNAVAILABLE', 'CLOCK_SKEWED'] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export function isFreshnessState(value: unknown): value is FreshnessState {
  return typeof value === 'string' && (FRESHNESS_STATES as readonly string[]).includes(value);
}

/**
 * THE downgrade law (deterministic, fail-closed):
 *   - FRESH        => authority unchanged.
 *   - anything else => 'UNAVAILABLE'.
 *
 * Rationale: a stale/skewed fact must never be consumed as if it were still
 * authoritative — not for live data, and not for replayed data either
 * (replay freshness is judged against the injected virtual clock, so a stale
 * replay fact is just as unusable inside the replayed world). Downgrading is
 * never an upgrade: UNAVAILABLE stays UNAVAILABLE in every state.
 */
export function downgradeAuthority(authority: DataAuthority, freshness: FreshnessState): DataAuthority {
  if (!isDataAuthority(authority)) {
    throw new TypeError(`downgradeAuthority: invalid authority ${JSON.stringify(authority)}`);
  }
  if (!isFreshnessState(freshness)) {
    throw new TypeError(`downgradeAuthority: invalid freshness state ${JSON.stringify(freshness)}`);
  }
  return freshness === 'FRESH' ? authority : 'UNAVAILABLE';
}

// ---------- explicit unknown-value discipline ----------

/** Marker for a fact whose value could not be determined right now. */
export const UNKNOWN = 'UNKNOWN' as const;
/** Marker for a fact whose source is missing/denied/off. */
export const UNAVAILABLE = 'UNAVAILABLE' as const;

export type UnknownState = typeof UNKNOWN | typeof UNAVAILABLE;

/**
 * A fact that may legitimately be unknown. `null` is the canonical "we do
 * not know" for numeric/object facts; string-state facts may use 'UNKNOWN'
 * or 'UNAVAILABLE'. Nothing in the foundation may replace an unknown with a
 * fabricated default (0, '', now, etc.).
 */
export type Unknownable<T> = T | null;

/**
 * Narrowing guard: true only when the value is an actual known fact.
 * `null`, `undefined`, 'UNKNOWN', and 'UNAVAILABLE' are all not-known.
 * Note: 0, '', and false ARE known values.
 */
export function isKnown<T>(value: T | null | undefined | UnknownState): value is T {
  return value !== null && value !== undefined && value !== UNKNOWN && value !== UNAVAILABLE;
}
