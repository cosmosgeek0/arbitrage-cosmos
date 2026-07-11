import type { RuntimeClock } from '../contracts/index.js';
import { exactConfigRecord } from './configValidation.js';

export interface ControlThrottleConfig {
  maximumMessages: number;
  intervalMs: number;
}

export interface ControlThrottleDecision {
  allowed: boolean;
  requested: number;
  remaining: number;
  retryAtMs: number | null;
  reason: 'AVAILABLE' | 'RATE_LIMITED';
}

export interface ControlThrottleSnapshot {
  maximumMessages: number;
  intervalMs: number;
  used: number;
  remaining: number;
  retryAtMs: number | null;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function safeTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('control throttle time must be a non-negative safe integer');
  }
  return value;
}

function addTime(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new RangeError('control throttle retry time exceeds the safe timestamp range');
  return value;
}

/** Exact rolling-window throttle; retained timestamps are bounded by the limit. */
export class ControlMessageThrottle {
  readonly #clock: RuntimeClock;
  readonly #maximumMessages: number;
  readonly #intervalMs: number;
  readonly #sentAtMs: number[] = [];
  #lastObservedAtMs: number | null = null;

  constructor(clock: RuntimeClock, config: ControlThrottleConfig) {
    if (typeof clock?.nowMs !== 'function') throw new TypeError('runtime clock is required');
    const projected = exactConfigRecord(config, ['maximumMessages', 'intervalMs'], 'control throttle config');
    this.#clock = clock;
    this.#maximumMessages = positiveInteger(projected.maximumMessages, 'maximumMessages');
    this.#intervalMs = positiveInteger(projected.intervalMs, 'intervalMs');
    if (this.#maximumMessages > 100_000) throw new RangeError('control throttle limit exceeds safety bound');
    if (this.#intervalMs > 7 * 24 * 60 * 60_000) throw new RangeError('control throttle interval exceeds safety bound');
  }

  acquire(count = 1, atMs?: number): Readonly<ControlThrottleDecision> {
    const requested = positiveInteger(count, 'control message count');
    const observedAtMs = this.#observeTime(atMs);
    this.#prune(observedAtMs);
    if (requested > this.#maximumMessages || this.#sentAtMs.length + requested > this.#maximumMessages) {
      return Object.freeze({
        allowed: false,
        requested,
        remaining: Math.max(0, this.#maximumMessages - this.#sentAtMs.length),
        retryAtMs: this.#sentAtMs.length === 0
          ? addTime(observedAtMs, this.#intervalMs)
          : addTime(this.#sentAtMs[0] as number, this.#intervalMs),
        reason: 'RATE_LIMITED',
      });
    }
    for (let index = 0; index < requested; index += 1) this.#sentAtMs.push(observedAtMs);
    return Object.freeze({
      allowed: true,
      requested,
      remaining: this.#maximumMessages - this.#sentAtMs.length,
      retryAtMs: null,
      reason: 'AVAILABLE',
    });
  }

  reset(): void {
    this.#sentAtMs.length = 0;
  }

  snapshot(atMs?: number): Readonly<ControlThrottleSnapshot> {
    const observedAtMs = this.#observeTime(atMs);
    this.#prune(observedAtMs);
    return Object.freeze({
      maximumMessages: this.#maximumMessages,
      intervalMs: this.#intervalMs,
      used: this.#sentAtMs.length,
      remaining: this.#maximumMessages - this.#sentAtMs.length,
      retryAtMs: this.#sentAtMs.length === 0 ? null : addTime(this.#sentAtMs[0] as number, this.#intervalMs),
    });
  }

  #prune(atMs: number): void {
    let expired = 0;
    while (expired < this.#sentAtMs.length && atMs - this.#sentAtMs[expired] >= this.#intervalMs) expired += 1;
    if (expired > 0) this.#sentAtMs.splice(0, expired);
  }

  #observeTime(atMs: number | undefined): number {
    const clockNowMs = safeTime(this.#clock.nowMs());
    const observedAtMs = atMs === undefined ? clockNowMs : safeTime(atMs);
    if (observedAtMs > clockNowMs) {
      throw new RangeError('control throttle time cannot be ahead of the injected clock');
    }
    if (this.#lastObservedAtMs !== null && observedAtMs < this.#lastObservedAtMs) {
      throw new RangeError('control throttle time cannot regress');
    }
    this.#lastObservedAtMs = observedAtMs;
    return observedAtMs;
  }
}
