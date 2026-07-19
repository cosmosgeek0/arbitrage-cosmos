export const RECONNECT_BACKOFF_BASE_MS = 1_000;
export const RECONNECT_BACKOFF_MAX_MS = 30_000;
export const RECONNECT_BACKOFF_STABLE_OPEN_MS = 30_000;
export const RECONNECT_BACKOFF_MAX_ATTEMPT = 32;

export type ReconnectBackoffState = Readonly<{
  attempt: number;
}>;

export type ReconnectBackoffPlan = Readonly<{
  next: ReconnectBackoffState;
  delayMs: number;
  ceilingMs: number;
  stableResetApplied: boolean;
}>;

export const INITIAL_RECONNECT_BACKOFF_STATE: ReconnectBackoffState = Object.freeze({
  attempt: 0,
});

/**
 * Plans one reconnect using capped exponential backoff with full jitter.
 * Entropy and the prior open duration are supplied by the caller so this
 * policy remains deterministic, clock-free, and independently testable.
 */
export function planReconnectBackoff(
  current: Readonly<ReconnectBackoffState>,
  input: Readonly<{
    entropySample: number;
    openDurationMs: number | null;
  }>,
): ReconnectBackoffPlan {
  const currentAttempt = Number.isSafeInteger(current.attempt)
    && current.attempt >= 0
    && current.attempt <= RECONNECT_BACKOFF_MAX_ATTEMPT
    ? current.attempt
    : RECONNECT_BACKOFF_MAX_ATTEMPT;
  const stableResetApplied = Number.isFinite(input.openDurationMs)
    && Number(input.openDurationMs) >= RECONNECT_BACKOFF_STABLE_OPEN_MS;
  const attemptBase = stableResetApplied ? 0 : currentAttempt;
  const attempt = Math.min(RECONNECT_BACKOFF_MAX_ATTEMPT, attemptBase + 1);
  const ceilingMs = Math.min(
    RECONNECT_BACKOFF_MAX_MS,
    RECONNECT_BACKOFF_BASE_MS * (2 ** Math.min(attempt - 1, 30)),
  );
  const entropySample = Number.isFinite(input.entropySample)
    && input.entropySample >= 0
    && input.entropySample < 1
    ? input.entropySample
    : 1;
  const delayMs = entropySample === 1
    ? ceilingMs
    : Math.floor(entropySample * (ceilingMs + 1));
  const next = Object.freeze({ attempt });

  return Object.freeze({
    next,
    delayMs,
    ceilingMs,
    stableResetApplied,
  });
}
