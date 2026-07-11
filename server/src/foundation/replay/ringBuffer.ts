/** Deterministic overwrite-oldest ring buffer with explicit loss accounting. */
import { MAX_REPLAY_RING_CAPACITY } from './types.js';

export interface RingBufferPushReport {
  size: number;
  capacity: number;
  evictedOldest: boolean;
  droppedCount: number;
  totalPushed: number;
}

export interface RingBufferSnapshot<T> {
  capacity: number;
  size: number;
  droppedCount: number;
  totalPushed: number;
  values: readonly T[];
}

export class BoundedRingBuffer<T> {
  readonly capacity: number;
  #slots: Array<T | undefined>;
  #head = 0;
  #size = 0;
  #droppedCount = 0;
  #totalPushed = 0;

  constructor(capacity: number) {
    if (
      !Number.isSafeInteger(capacity) ||
      capacity <= 0 ||
      capacity > MAX_REPLAY_RING_CAPACITY
    ) {
      throw new TypeError(
        `BoundedRingBuffer: capacity must be an integer in [1, ${MAX_REPLAY_RING_CAPACITY}]`,
      );
    }
    this.capacity = capacity;
    this.#slots = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.#size;
  }

  get droppedCount(): number {
    return this.#droppedCount;
  }

  get totalPushed(): number {
    return this.#totalPushed;
  }

  push(value: T): Readonly<RingBufferPushReport> {
    if (this.#totalPushed === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('BoundedRingBuffer: totalPushed exceeded safe-integer range');
    }
    const evictedOldest = this.#size === this.capacity;
    if (evictedOldest && this.#droppedCount === Number.MAX_SAFE_INTEGER) {
      throw new RangeError('BoundedRingBuffer: droppedCount exceeded safe-integer range');
    }

    if (evictedOldest) {
      this.#slots[this.#head] = value;
      this.#head = (this.#head + 1) % this.capacity;
      this.#droppedCount += 1;
    } else {
      const writeIndex = (this.#head + this.#size) % this.capacity;
      this.#slots[writeIndex] = value;
      this.#size += 1;
    }
    this.#totalPushed += 1;

    return Object.freeze({
      size: this.#size,
      capacity: this.capacity,
      evictedOldest,
      droppedCount: this.#droppedCount,
      totalPushed: this.#totalPushed,
    });
  }

  values(): readonly T[] {
    const output: T[] = [];
    for (let i = 0; i < this.#size; i += 1) {
      const value = this.#slots[(this.#head + i) % this.capacity];
      // All logical positions are written; undefined can itself be a T value.
      output.push(value as T);
    }
    return Object.freeze(output);
  }

  snapshot(): Readonly<RingBufferSnapshot<T>> {
    return Object.freeze({
      capacity: this.capacity,
      size: this.#size,
      droppedCount: this.#droppedCount,
      totalPushed: this.#totalPushed,
      values: this.values(),
    });
  }
}
