import type {
  RuntimeBackoffState,
  RuntimeClock,
  RuntimeJitterSource,
} from '../contracts/index.js';
import { exactConfigRecord } from './configValidation.js';

export interface DeterministicBackoffConfig {
  baseDelayMs: number;
  maximumDelayMs: number;
  retryCeiling: number;
  cooldownMs: number;
  /** Symmetric jitter around 1. A value of 0.2 produces factors in [0.8, 1.2]. */
  jitterRatio: number;
}

export type BackoffDecision =
  | {
      state: 'RETRY_SCHEDULED';
      attempt: number;
      delayMs: number;
      retryAtMs: number;
      cooldownUntilMs: null;
    }
  | {
      state: 'COOLDOWN';
      attempt: number;
      delayMs: number;
      retryAtMs: number;
      cooldownUntilMs: number;
    };

function safeInteger(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function safeNow(clock: RuntimeClock): number {
  return safeInteger(clock.nowMs(), 'clock.nowMs');
}

function validateConfig(config: DeterministicBackoffConfig): Readonly<DeterministicBackoffConfig> {
  const projected = exactConfigRecord(
    config,
    ['baseDelayMs', 'maximumDelayMs', 'retryCeiling', 'cooldownMs', 'jitterRatio'],
    'backoff config',
  );
  const baseDelayMs = safeInteger(projected.baseDelayMs, 'baseDelayMs', 1);
  const maximumDelayMs = safeInteger(projected.maximumDelayMs, 'maximumDelayMs', 1);
  const retryCeiling = safeInteger(projected.retryCeiling, 'retryCeiling');
  const cooldownMs = safeInteger(projected.cooldownMs, 'cooldownMs', 1);
  if (maximumDelayMs < baseDelayMs) throw new TypeError('maximumDelayMs must be at least baseDelayMs');
  if (baseDelayMs > 7 * 24 * 60 * 60_000 || maximumDelayMs > 7 * 24 * 60 * 60_000
    || cooldownMs > 30 * 24 * 60 * 60_000 || retryCeiling > 1_000) {
    throw new RangeError('backoff policy exceeds its hard safety bound');
  }
  const jitterRatio = projected.jitterRatio;
  if (typeof jitterRatio !== 'number' || !Number.isFinite(jitterRatio)
    || jitterRatio < 0 || jitterRatio > 1) {
    throw new TypeError('jitterRatio must be finite and in [0, 1]');
  }
  return Object.freeze({ baseDelayMs, maximumDelayMs, retryCeiling, cooldownMs, jitterRatio });
}

/**
 * Tick-driven exponential backoff. It owns no timer and never reads ambient
 * randomness: the caller supplies both the clock and jitter source.
 */
export class DeterministicBackoff {
  readonly #clock: RuntimeClock;
  readonly #jitter: RuntimeJitterSource;
  readonly #config: Readonly<DeterministicBackoffConfig>;
  #attempt = 0;
  #delayMs: number | null = null;
  #retryAtMs: number | null = null;
  #cooldownUntilMs: number | null = null;
  #lastObservedAtMs: number;

  constructor(clock: RuntimeClock, jitter: RuntimeJitterSource, config: DeterministicBackoffConfig) {
    if (typeof clock?.nowMs !== 'function') throw new TypeError('runtime clock is required');
    if (typeof jitter?.next !== 'function') throw new TypeError('runtime jitter source is required');
    this.#clock = clock;
    this.#jitter = jitter;
    this.#config = validateConfig(config);
    this.#lastObservedAtMs = safeNow(clock);
  }

  fail(atMs?: number): BackoffDecision {
    const observedAtMs = this.#observeTime(atMs, 'backoff failure time');
    if (this.#cooldownUntilMs !== null && observedAtMs < this.#cooldownUntilMs) {
      return Object.freeze({
        state: 'COOLDOWN',
        attempt: this.#attempt,
        delayMs: this.#cooldownUntilMs - observedAtMs,
        retryAtMs: this.#cooldownUntilMs,
        cooldownUntilMs: this.#cooldownUntilMs,
      });
    }
    const expiredCooldown = this.#cooldownUntilMs !== null;
    const currentAttempt = expiredCooldown ? 0 : this.#attempt;

    if (currentAttempt >= this.#config.retryCeiling) {
      const retryAtMs = observedAtMs + this.#config.cooldownMs;
      if (!Number.isSafeInteger(retryAtMs)) throw new RangeError('backoff cooldown timestamp overflow');
      this.#attempt = currentAttempt;
      this.#delayMs = this.#config.cooldownMs;
      this.#retryAtMs = retryAtMs;
      this.#cooldownUntilMs = retryAtMs;
      return Object.freeze({
        state: 'COOLDOWN',
        attempt: currentAttempt,
        delayMs: this.#config.cooldownMs,
        retryAtMs,
        cooldownUntilMs: retryAtMs,
      });
    }

    const nextAttempt = currentAttempt + 1;
    const exponent = Math.min(52, nextAttempt - 1);
    const unbounded = this.#config.baseDelayMs * (2 ** exponent);
    const base = Math.min(this.#config.maximumDelayMs, Number.isFinite(unbounded) ? unbounded : this.#config.maximumDelayMs);
    const sample = this.#jitter.next();
    if (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0 || sample > 1) {
      throw new TypeError('runtime jitter source must return a finite number in [0, 1]');
    }
    const factor = 1 - this.#config.jitterRatio + (2 * this.#config.jitterRatio * sample);
    const delayMs = Math.max(1, Math.min(this.#config.maximumDelayMs, Math.round(base * factor)));
    const retryAtMs = observedAtMs + delayMs;
    if (!Number.isSafeInteger(retryAtMs)) throw new RangeError('backoff retry timestamp overflow');
    this.#attempt = nextAttempt;
    this.#delayMs = delayMs;
    this.#retryAtMs = retryAtMs;
    this.#cooldownUntilMs = null;
    return Object.freeze({
      state: 'RETRY_SCHEDULED',
      attempt: this.#attempt,
      delayMs: this.#delayMs,
      retryAtMs: this.#retryAtMs,
      cooldownUntilMs: null,
    });
  }

  retryDue(atMs?: number): boolean {
    const observedAtMs = this.#observeTime(atMs, 'backoff tick time');
    return this.#retryAtMs !== null && observedAtMs >= this.#retryAtMs;
  }

  consumeRetry(atMs?: number): boolean {
    const observedAtMs = this.#observeTime(atMs, 'backoff consume time');
    if (this.#retryAtMs === null || observedAtMs < this.#retryAtMs || this.#cooldownUntilMs !== null) return false;
    this.#delayMs = null;
    this.#retryAtMs = null;
    return true;
  }

  releaseCooldown(atMs?: number): boolean {
    const observedAtMs = this.#observeTime(atMs, 'cooldown tick time');
    if (this.#cooldownUntilMs === null || observedAtMs < this.#cooldownUntilMs) return false;
    this.reset();
    return true;
  }

  reset(): void {
    this.#attempt = 0;
    this.#delayMs = null;
    this.#retryAtMs = null;
    this.#cooldownUntilMs = null;
  }

  snapshot(): Readonly<RuntimeBackoffState> {
    return Object.freeze({
      attempt: this.#attempt,
      ceiling: this.#config.retryCeiling,
      delayMs: this.#delayMs,
      retryAtMs: this.#retryAtMs,
      cooldownUntilMs: this.#cooldownUntilMs,
    });
  }

  #observeTime(atMs: number | undefined, name: string): number {
    const now = safeNow(this.#clock);
    const observedAtMs = atMs === undefined ? now : safeInteger(atMs, name);
    if (observedAtMs > now) throw new RangeError(`${name} cannot be ahead of the injected clock`);
    if (observedAtMs < this.#lastObservedAtMs) throw new RangeError(`${name} cannot regress`);
    this.#lastObservedAtMs = observedAtMs;
    return observedAtMs;
  }
}
