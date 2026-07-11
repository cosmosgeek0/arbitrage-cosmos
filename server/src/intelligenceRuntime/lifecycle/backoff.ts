import type {
  RuntimeBackoffState,
  RuntimeClock,
  RuntimeJitterSource,
} from '../contracts/index.js';

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
  const baseDelayMs = safeInteger(config.baseDelayMs, 'baseDelayMs', 1);
  const maximumDelayMs = safeInteger(config.maximumDelayMs, 'maximumDelayMs', 1);
  const retryCeiling = safeInteger(config.retryCeiling, 'retryCeiling');
  const cooldownMs = safeInteger(config.cooldownMs, 'cooldownMs', 1);
  if (maximumDelayMs < baseDelayMs) throw new TypeError('maximumDelayMs must be at least baseDelayMs');
  if (typeof config.jitterRatio !== 'number' || !Number.isFinite(config.jitterRatio)
    || config.jitterRatio < 0 || config.jitterRatio > 1) {
    throw new TypeError('jitterRatio must be finite and in [0, 1]');
  }
  return Object.freeze({ baseDelayMs, maximumDelayMs, retryCeiling, cooldownMs, jitterRatio: config.jitterRatio });
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

  constructor(clock: RuntimeClock, jitter: RuntimeJitterSource, config: DeterministicBackoffConfig) {
    if (typeof clock?.nowMs !== 'function') throw new TypeError('runtime clock is required');
    if (typeof jitter?.next !== 'function') throw new TypeError('runtime jitter source is required');
    this.#clock = clock;
    this.#jitter = jitter;
    this.#config = validateConfig(config);
  }

  fail(atMs = safeNow(this.#clock)): BackoffDecision {
    safeInteger(atMs, 'backoff failure time');
    if (this.#cooldownUntilMs !== null && atMs < this.#cooldownUntilMs) {
      return Object.freeze({
        state: 'COOLDOWN',
        attempt: this.#attempt,
        delayMs: this.#cooldownUntilMs - atMs,
        retryAtMs: this.#cooldownUntilMs,
        cooldownUntilMs: this.#cooldownUntilMs,
      });
    }
    if (this.#cooldownUntilMs !== null) this.reset();

    if (this.#attempt >= this.#config.retryCeiling) {
      this.#delayMs = this.#config.cooldownMs;
      this.#retryAtMs = atMs + this.#config.cooldownMs;
      if (!Number.isSafeInteger(this.#retryAtMs)) throw new RangeError('backoff cooldown timestamp overflow');
      this.#cooldownUntilMs = this.#retryAtMs;
      return Object.freeze({
        state: 'COOLDOWN',
        attempt: this.#attempt,
        delayMs: this.#delayMs,
        retryAtMs: this.#retryAtMs,
        cooldownUntilMs: this.#cooldownUntilMs,
      });
    }

    this.#attempt += 1;
    const exponent = Math.min(52, this.#attempt - 1);
    const unbounded = this.#config.baseDelayMs * (2 ** exponent);
    const base = Math.min(this.#config.maximumDelayMs, Number.isFinite(unbounded) ? unbounded : this.#config.maximumDelayMs);
    const sample = this.#jitter.next();
    if (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0 || sample > 1) {
      throw new TypeError('runtime jitter source must return a finite number in [0, 1]');
    }
    const factor = 1 - this.#config.jitterRatio + (2 * this.#config.jitterRatio * sample);
    this.#delayMs = Math.max(1, Math.min(this.#config.maximumDelayMs, Math.round(base * factor)));
    this.#retryAtMs = atMs + this.#delayMs;
    if (!Number.isSafeInteger(this.#retryAtMs)) throw new RangeError('backoff retry timestamp overflow');
    this.#cooldownUntilMs = null;
    return Object.freeze({
      state: 'RETRY_SCHEDULED',
      attempt: this.#attempt,
      delayMs: this.#delayMs,
      retryAtMs: this.#retryAtMs,
      cooldownUntilMs: null,
    });
  }

  retryDue(atMs = safeNow(this.#clock)): boolean {
    safeInteger(atMs, 'backoff tick time');
    return this.#retryAtMs !== null && atMs >= this.#retryAtMs;
  }

  consumeRetry(atMs = safeNow(this.#clock)): boolean {
    if (!this.retryDue(atMs) || this.#cooldownUntilMs !== null) return false;
    this.#delayMs = null;
    this.#retryAtMs = null;
    return true;
  }

  releaseCooldown(atMs = safeNow(this.#clock)): boolean {
    safeInteger(atMs, 'cooldown tick time');
    if (this.#cooldownUntilMs === null || atMs < this.#cooldownUntilMs) return false;
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
}
