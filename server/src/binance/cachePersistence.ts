/**
 * Durable-cache persist failure accounting (Part 4 #14).
 *
 * The four durable caches (news archive, liquidations, profiles, icons)
 * deliberately swallow persist failures so a degraded disk never crashes a
 * request path. But a lost data-dir lease — writing into a directory this
 * process no longer owns — was discarded with exactly the same silence as
 * ENOSPC. The swallow stays; this module adds the count and a bounded stderr
 * line so the failure class is observable.
 *
 * Logging is bounded per cache (first failure, then every LOG_EVERY-th) so a
 * persistently failing timer cannot flood the journal.
 */

const LOG_EVERY = 100;

interface CacheFailureState {
  count: number;
  lastAtMs: number;
  lastReason: string;
}

const failuresByCache = new Map<string, CacheFailureState>();
let totalFailures = 0;

export function noteCachePersistFailure(cache: string, error: unknown): void {
  totalFailures += 1;
  const reason = error instanceof Error ? error.message : String(error);
  const state = failuresByCache.get(cache) ?? { count: 0, lastAtMs: 0, lastReason: '' };
  state.count += 1;
  state.lastAtMs = Date.now();
  state.lastReason = reason;
  failuresByCache.set(cache, state);
  if (state.count === 1 || state.count % LOG_EVERY === 0) {
    console.error(
      `durable cache persist failed (${cache}, occurrence ${state.count}):`,
      reason,
    );
  }
}

/** Monotonic total across all caches, for diagnostic surfaces. */
export function cachePersistFailureCount(): number {
  return totalFailures;
}

/** Per-cache snapshot, for diagnostic surfaces. */
export function cachePersistFailureSnapshot(): Readonly<
  Record<string, { count: number; lastAtMs: number; lastReason: string }>
> {
  const snapshot: Record<string, { count: number; lastAtMs: number; lastReason: string }> = {};
  for (const [cache, state] of failuresByCache) snapshot[cache] = { ...state };
  return Object.freeze(snapshot);
}
