/** Explicit virtual clock. No wall time, timers, or automatic advancement. */
import { isValidUtcMillis } from '../contracts/index.js';
import type { ReplayVirtualClockPort } from './types.js';

export class DeterministicVirtualClock implements ReplayVirtualClockPort {
  #nowMs: number;

  constructor(startAtMs: number) {
    if (!isValidUtcMillis(startAtMs)) {
      throw new TypeError('DeterministicVirtualClock: startAtMs must be valid UTC ms');
    }
    this.#nowMs = startAtMs;
  }

  nowMs(): number {
    return this.#nowMs;
  }

  advanceTo(targetMs: number): void {
    if (!isValidUtcMillis(targetMs)) {
      throw new TypeError('DeterministicVirtualClock.advanceTo: targetMs must be valid UTC ms');
    }
    if (targetMs < this.#nowMs) {
      throw new RangeError('DeterministicVirtualClock cannot move backwards');
    }
    this.#nowMs = targetMs;
  }
}
