/**
 * Engine Chassis v0 — injectable time source (Director-owned frozen contract).
 * Engine modules must take a Clock; never call Date.now() directly, so tests
 * are deterministic.
 */
import type { Clock } from './types.js';

export const systemClock: Clock = { now: () => Date.now() };

/** Deterministic clock for synthetic tests. */
export class ManualClock implements Clock {
  constructor(private t = 0) {}
  now(): number {
    return this.t;
  }
  set(t: number): void {
    this.t = t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

let corrSeq = 0;
/** Correlation id: unique per signal path, sortable, test-stable enough. */
export function newCorrelationId(clock: Clock, prefix = 'cx'): string {
  corrSeq = (corrSeq + 1) % 1_000_000;
  return `${prefix}_${clock.now().toString(36)}_${corrSeq.toString(36)}`;
}
