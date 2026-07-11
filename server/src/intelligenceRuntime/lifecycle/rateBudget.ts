import type { RuntimeClock, RuntimeRateBudgetState } from '../contracts/index.js';
import { exactConfigRecord } from './configValidation.js';

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

function exactHeaderEntries(
  headers: Readonly<Record<string, string>> | null | undefined,
): readonly (readonly [string, string])[] {
  if (headers === null || headers === undefined) return Object.freeze([]);
  if (typeof headers !== 'object' || Array.isArray(headers)) {
    throw new TypeError('REST rate headers must be a plain object');
  }
  const prototype = Object.getPrototypeOf(headers);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('REST rate headers must be a plain object');
  }
  if (Object.getOwnPropertySymbols(headers).length > 0) {
    throw new TypeError('REST rate headers cannot contain symbol keys');
  }
  const descriptors = Object.getOwnPropertyDescriptors(headers);
  const names = Object.keys(descriptors);
  if (names.length > 256) throw new RangeError('REST rate headers exceed the header-count bound');
  const entries: Array<readonly [string, string]> = [];
  for (const name of names) {
    const descriptor = descriptors[name];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError('REST rate headers must contain enumerable data properties only');
    }
    if (name.length === 0 || name.length > 256 || typeof descriptor.value !== 'string'
      || descriptor.value.length > 8_192) {
      throw new TypeError('REST rate header name or value exceeds its bounded string contract');
    }
    entries.push(Object.freeze([name, descriptor.value] as const));
  }
  return Object.freeze(entries);
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
  for (const [name, value] of exactHeaderEntries(headers)) {
    lower[name.toLowerCase()] = value;
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
    const projected = exactConfigRecord(
      config,
      ['limit', 'intervalMs', 'nearLimitRatio', 'defaultCooldownMs'],
      'REST weight budget config',
    );
    const limit = safeInteger(projected.limit, 'weight limit', 1);
    const intervalMs = safeInteger(projected.intervalMs, 'weight interval', 1);
    const defaultCooldownMs = safeInteger(projected.defaultCooldownMs, 'defaultCooldownMs', 1);
    if (limit > 1_000_000_000) throw new RangeError('weight limit exceeds hard bound');
    if (intervalMs > 7 * 24 * 60 * 60_000) throw new RangeError('weight interval exceeds hard bound');
    if (defaultCooldownMs > 3 * 24 * 60 * 60_000) throw new RangeError('defaultCooldownMs exceeds hard bound');
    const nearLimitRatio = projected.nearLimitRatio;
    if (typeof nearLimitRatio !== 'number' || !Number.isFinite(nearLimitRatio)
      || nearLimitRatio <= 0 || nearLimitRatio >= 1) {
      throw new TypeError('nearLimitRatio must be finite and in (0, 1)');
    }
    this.#clock = clock;
    this.#config = Object.freeze({ limit, intervalMs, defaultCooldownMs, nearLimitRatio });
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
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new TypeError('REST response budget observation must be a plain object');
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('REST response budget observation must be a plain object');
    }
    const allowed = new Set(['status', 'headers', 'unreservedRequestWeight', 'observedAtMs']);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Object.getOwnPropertySymbols(input).length > 0
      || Object.keys(descriptors).some((key) => !allowed.has(key))) {
      throw new TypeError('REST response budget observation contains unsupported fields');
    }
    for (const required of ['status', 'headers'] as const) {
      const descriptor = descriptors[required];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError(`REST response budget observation ${required} must be an enumerable data property`);
      }
    }
    for (const optional of ['unreservedRequestWeight', 'observedAtMs'] as const) {
      const descriptor = descriptors[optional];
      if (descriptor && (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) {
        throw new TypeError(`REST response budget observation ${optional} must be an enumerable data property`);
      }
    }
    const observedAtMs = descriptors.observedAtMs?.value as number | undefined;
    const atMs = observedAtMs ?? this.#now();
    safeInteger(atMs, 'response observation time');
    const status = safeInteger(descriptors.status?.value, 'HTTP status', 100);
    if (status > 599) throw new TypeError('HTTP status must be in [100, 599]');
    const parsed = parseRestRateHeaders(descriptors.headers?.value as Readonly<Record<string, string>>);
    const rawUnreservedWeight = descriptors.unreservedRequestWeight?.value as number | undefined;
    const unreservedWeight = rawUnreservedWeight === undefined
      ? null
      : safeInteger(rawUnreservedWeight, 'unreserved request weight', 1);
    const cooldown = status === 418 || status === 429
      ? parsed.retryAfterMs ?? this.#config.defaultCooldownMs
      : null;
    const cooldownUntilMs = cooldown === null ? null : atMs + cooldown;
    if (cooldownUntilMs !== null && !Number.isSafeInteger(cooldownUntilMs)) {
      throw new RangeError('rate-limit cooldown timestamp overflow');
    }
    if (rawUnreservedWeight !== undefined) {
      this.tick(atMs);
      this.#usedWeight = Math.min(Number.MAX_SAFE_INTEGER, this.#usedWeight + (unreservedWeight as number));
    } else {
      this.tick(atMs);
    }
    if (parsed.usedWeight !== null) this.#usedWeight = parsed.usedWeight;
    this.#observedAtMs = atMs;
    if (cooldown !== null) {
      this.#retryAfterMs = cooldown;
      this.#cooldownUntilMs = cooldownUntilMs;
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
    if (atMs > this.#now()) throw new RangeError('rate-budget observation time cannot be ahead of the injected clock');
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
