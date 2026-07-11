import type { RuntimeClock } from '../contracts/index.js';

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

/** Exact rolling-window throttle; retained timestamps are bounded by the limit. */
export class ControlMessageThrottle {
  readonly #clock: RuntimeClock;
  readonly #maximumMessages: number;
  readonly #intervalMs: number;
  readonly #sentAtMs: number[] = [];

  constructor(clock: RuntimeClock, config: ControlThrottleConfig) {
    if (typeof clock?.nowMs !== 'function') throw new TypeError('runtime clock is required');
    this.#clock = clock;
    this.#maximumMessages = positiveInteger(config.maximumMessages, 'maximumMessages');
    this.#intervalMs = positiveInteger(config.intervalMs, 'intervalMs');
    if (this.#maximumMessages > 100_000) throw new RangeError('control throttle limit exceeds safety bound');
  }

  acquire(count = 1, atMs = safeTime(this.#clock.nowMs())): Readonly<ControlThrottleDecision> {
    const requested = positiveInteger(count, 'control message count');
    safeTime(atMs);
    this.#prune(atMs);
    if (requested > this.#maximumMessages || this.#sentAtMs.length + requested > this.#maximumMessages) {
      return Object.freeze({
        allowed: false,
        requested,
        remaining: Math.max(0, this.#maximumMessages - this.#sentAtMs.length),
        retryAtMs: this.#sentAtMs.length === 0 ? atMs + this.#intervalMs : this.#sentAtMs[0] + this.#intervalMs,
        reason: 'RATE_LIMITED',
      });
    }
    for (let index = 0; index < requested; index += 1) this.#sentAtMs.push(atMs);
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

  snapshot(atMs = safeTime(this.#clock.nowMs())): Readonly<ControlThrottleSnapshot> {
    safeTime(atMs);
    this.#prune(atMs);
    return Object.freeze({
      maximumMessages: this.#maximumMessages,
      intervalMs: this.#intervalMs,
      used: this.#sentAtMs.length,
      remaining: this.#maximumMessages - this.#sentAtMs.length,
      retryAtMs: this.#sentAtMs.length === 0 ? null : this.#sentAtMs[0] + this.#intervalMs,
    });
  }

  #prune(atMs: number): void {
    let expired = 0;
    while (expired < this.#sentAtMs.length && atMs - this.#sentAtMs[expired] >= this.#intervalMs) expired += 1;
    if (expired > 0) this.#sentAtMs.splice(0, expired);
  }
}
