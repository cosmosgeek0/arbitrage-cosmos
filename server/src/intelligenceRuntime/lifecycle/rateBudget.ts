import type { RuntimeClock, RuntimeRateBudgetState } from '../contracts/index.js';

export interface RestWeightBudgetConfig {
  limit: number;
  intervalMs: number;
  nearLimitRatio: number;
  defaultCooldownMs: number;
}

export interface ParsedRestRateHeaders {
  usedWeight: number | null;
  retryAfterMs: number | null;
}

export interface WeightReservation {
  allowed: boolean;
  weight: number;
  retryAtMs: number | null;
  reason: 'AVAILABLE' | 'WEIGHT_EXHAUSTED' | 'COOLDOWN';
  budget: RuntimeRateBudgetState;
}

export interface RestResponseBudgetObservation {
  status: number;
  headers: Readonly<Record<string, string>>;
  /** Use only when reserve() was not called for this request. */
  unreservedRequestWeight?: number;
  observedAtMs?: number;
}

function safeInteger(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function safeHeaderInteger(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,15}$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function fixedIntervalWindow(atMs: number, intervalMs: number): Readonly<{
  startedAtMs: number;
  resetsAtMs: number;
}> {
  const startedAtMs = Math.floor(atMs / intervalMs) * intervalMs;
  const resetsAtMs = startedAtMs + intervalMs;
  if (!Number.isSafeInteger(startedAtMs) || !Number.isSafeInteger(resetsAtMs)) {
    throw new RangeError('weight reset timestamp overflow');
  }
  return Object.freeze({ startedAtMs, resetsAtMs });
}

export function parseRestRateHeaders(
  headers: Readonly<Record<string, string>> | null | undefined,
): Readonly<ParsedRestRateHeaders> {
  const lower: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') lower[name.toLowerCase()] = value;
  }
  const weights = [
    safeHeaderInteger(lower['x-mbx-used-weight-1m']),
    safeHeaderInteger(lower['x-mbx-used-weight']),
    safeHeaderInteger(lower['x-sapi-used-ip-weight-1m']),
  ].filter((value): value is number => value !== null);
  const retrySeconds = safeHeaderInteger(lower['retry-after']);
  return Object.freeze({
    usedWeight: weights.length === 0 ? null : Math.max(...weights),
    retryAfterMs: retrySeconds !== null && retrySeconds <= 259_200 ? retrySeconds * 1_000 : null,
  });
}

/**
 * Deterministic local REST-weight ledger. Venue headers replace local estimates;
 * missing headers preserve the explicitly reserved request cost. Weight windows
 * are fixed wall-clock intervals, matching Binance's interval counters, rather
 * than rolling intervals anchored to process construction or response arrival.
 */
export class RestWeightBudget {
  readonly #clock: RuntimeClock;
  readonly #config: Readonly<RestWeightBudgetConfig>;
  #usedWeight = 0;
  #windowStartedAtMs: number;
  #resetsAtMs: number;
  #cooldownUntilMs: number | null = null;
  #retryAfterMs: number | null = null;
  #observedAtMs: number;

  constructor(clock: RuntimeClock, config: RestWeightBudgetConfig) {
    if (typeof clock?.nowMs !== 'function') throw new TypeError('runtime clock is required');
    const limit = safeInteger(config.limit, 'weight limit', 1);
    const intervalMs = safeInteger(config.intervalMs, 'weight interval', 1);
    const defaultCooldownMs = safeInteger(config.defaultCooldownMs, 'defaultCooldownMs', 1);
    if (typeof config.nearLimitRatio !== 'number' || !Number.isFinite(config.nearLimitRatio)
      || config.nearLimitRatio <= 0 || config.nearLimitRatio >= 1) {
      throw new TypeError('nearLimitRatio must be finite and in (0, 1)');
    }
    this.#clock = clock;
    this.#config = Object.freeze({ limit, intervalMs, defaultCooldownMs, nearLimitRatio: config.nearLimitRatio });
    const now = safeInteger(clock.nowMs(), 'clock.nowMs');
    const window = fixedIntervalWindow(now, intervalMs);
    this.#windowStartedAtMs = window.startedAtMs;
    this.#resetsAtMs = window.resetsAtMs;
    this.#observedAtMs = now;
  }

  reserve(weight: number, atMs = this.#now()): Readonly<WeightReservation> {
    const requested = safeInteger(weight, 'request weight', 1);
    this.tick(atMs);
    if (this.#cooldownUntilMs !== null) {
      return Object.freeze({
        allowed: false,
        weight: requested,
        retryAtMs: this.#cooldownUntilMs,
        reason: 'COOLDOWN',
        budget: this.snapshot(atMs),
      });
    }
    if (requested > this.#config.limit || this.#usedWeight + requested > this.#config.limit) {
      return Object.freeze({
        allowed: false,
        weight: requested,
        retryAtMs: this.#resetsAtMs,
        reason: 'WEIGHT_EXHAUSTED',
        budget: this.snapshot(atMs),
      });
    }
    this.#usedWeight += requested;
    this.#observedAtMs = atMs;
    return Object.freeze({
      allowed: true,
      weight: requested,
      retryAtMs: null,
      reason: 'AVAILABLE',
      budget: this.snapshot(atMs),
    });
  }

  observeResponse(input: RestResponseBudgetObservation): Readonly<RuntimeRateBudgetState> {
    const atMs = input.observedAtMs ?? this.#now();
    safeInteger(atMs, 'response observation time');
    const status = safeInteger(input.status, 'HTTP status', 100);
    if (status > 599) throw new TypeError('HTTP status must be in [100, 599]');
    if (input.unreservedRequestWeight !== undefined) {
      const weight = safeInteger(input.unreservedRequestWeight, 'unreserved request weight', 1);
      this.tick(atMs);
      this.#usedWeight = Math.min(Number.MAX_SAFE_INTEGER, this.#usedWeight + weight);
    } else {
      this.tick(atMs);
    }
    const parsed = parseRestRateHeaders(input.headers);
    if (parsed.usedWeight !== null) this.#usedWeight = parsed.usedWeight;
    this.#observedAtMs = atMs;
    if (status === 418 || status === 429) {
      const cooldown = parsed.retryAfterMs ?? this.#config.defaultCooldownMs;
      this.#retryAfterMs = cooldown;
      this.#cooldownUntilMs = atMs + cooldown;
      if (!Number.isSafeInteger(this.#cooldownUntilMs)) throw new RangeError('rate-limit cooldown timestamp overflow');
    }
    return this.snapshot(atMs);
  }

  tick(atMs = this.#now()): Readonly<RuntimeRateBudgetState> {
    this.#advance(atMs);
    return this.#render(atMs);
  }

  snapshot(atMs = this.#now()): Readonly<RuntimeRateBudgetState> {
    this.#advance(atMs);
    return this.#render(atMs);
  }

  #advance(atMs: number): void {
    safeInteger(atMs, 'rate-budget observation time');
    if (atMs < this.#observedAtMs) throw new RangeError('rate-budget clock regressed');
    if (atMs >= this.#resetsAtMs) {
      const window = fixedIntervalWindow(atMs, this.#config.intervalMs);
      this.#windowStartedAtMs = window.startedAtMs;
      this.#resetsAtMs = window.resetsAtMs;
      this.#usedWeight = 0;
    }
    if (this.#cooldownUntilMs !== null && atMs >= this.#cooldownUntilMs) {
      this.#cooldownUntilMs = null;
      this.#retryAfterMs = null;
    }
    this.#observedAtMs = atMs;
  }

  #render(atMs: number): Readonly<RuntimeRateBudgetState> {
    const ratio = this.#usedWeight / this.#config.limit;
    const state: RuntimeRateBudgetState['state'] = this.#cooldownUntilMs !== null && atMs < this.#cooldownUntilMs
      ? 'COOLDOWN'
      : this.#usedWeight >= this.#config.limit
        ? 'EXHAUSTED'
        : ratio >= this.#config.nearLimitRatio
          ? 'NEAR_LIMIT'
          : 'AVAILABLE';
    return Object.freeze({
      state,
      usedWeight: this.#usedWeight,
      limit: this.#config.limit,
      intervalMs: this.#config.intervalMs,
      resetsAtMs: this.#resetsAtMs,
      retryAfterMs: state === 'COOLDOWN' ? this.#retryAfterMs : null,
      observedAtMs: this.#observedAtMs,
    });
  }

  #now(): number {
    return safeInteger(this.#clock.nowMs(), 'clock.nowMs');
  }
}
