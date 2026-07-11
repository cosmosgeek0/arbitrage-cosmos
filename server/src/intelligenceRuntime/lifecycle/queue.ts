export type InboundQueueMode = 'REPLACEABLE' | 'SEQUENCE_SENSITIVE';

export interface InboundQueueEntry<T> {
  id: string;
  mode: InboundQueueMode;
  /** Required for replaceable state; ignored for sequence-sensitive entries. */
  coalescingKey: string | null;
  receiveTimeMs: number;
  value: T;
}

export interface QueueOfferResult {
  accepted: boolean;
  action: 'ENQUEUED' | 'COALESCED' | 'DROPPED' | 'EVICTED_REPLACEABLE' | 'IGNORED_OLDER';
  dropped: number;
  coalesced: number;
  requiresResync: boolean;
  reason: string;
}

export interface BoundedQueueSnapshot {
  capacity: number;
  depth: number;
  highWatermark: number;
  enqueuedCount: number;
  dequeuedCount: number;
  droppedCount: number;
  coalescedCount: number;
  overflowCount: number;
  resyncRequired: boolean;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function validateEntry<T>(entry: InboundQueueEntry<T>): void {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new TypeError('queue entry is required');
  if (typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 512) {
    throw new TypeError('queue entry id must be a bounded non-empty string');
  }
  if (entry.mode !== 'REPLACEABLE' && entry.mode !== 'SEQUENCE_SENSITIVE') throw new TypeError('queue mode is invalid');
  if (!Number.isSafeInteger(entry.receiveTimeMs) || entry.receiveTimeMs < 0) throw new TypeError('queue receive time is invalid');
  if (entry.mode === 'REPLACEABLE'
    && (typeof entry.coalescingKey !== 'string' || entry.coalescingKey.length === 0 || entry.coalescingKey.length > 512)) {
    throw new TypeError('replaceable queue entries require a bounded coalescing key');
  }
}

/**
 * Bounded FIFO with explicit state coalescing. Sequence-sensitive entries are
 * never coalesced or evicted; overflow instead raises a resync requirement.
 */
export class BoundedInboundQueue<T> {
  readonly #capacity: number;
  readonly #entries: InboundQueueEntry<T>[] = [];
  #highWatermark = 0;
  #enqueuedCount = 0;
  #dequeuedCount = 0;
  #droppedCount = 0;
  #coalescedCount = 0;
  #overflowCount = 0;
  #resyncRequired = false;
  #lastOfferedReceiveTimeMs: number | null = null;

  constructor(capacity: number) {
    this.#capacity = positiveInteger(capacity, 'queue capacity');
    if (capacity > 1_000_000) throw new RangeError('queue capacity exceeds the hard safety bound');
  }

  offer(entry: InboundQueueEntry<T>): Readonly<QueueOfferResult> {
    validateEntry(entry);
    const frozen = Object.freeze({ ...entry });
    if (this.#lastOfferedReceiveTimeMs !== null && entry.receiveTimeMs < this.#lastOfferedReceiveTimeMs) {
      this.#droppedCount += 1;
      if (entry.mode === 'SEQUENCE_SENSITIVE') this.#resyncRequired = true;
      return Object.freeze({
        accepted: false,
        action: 'IGNORED_OLDER',
        dropped: 1,
        coalesced: 0,
        requiresResync: this.#resyncRequired,
        reason: entry.mode === 'SEQUENCE_SENSITIVE'
          ? 'regressed sequence-sensitive receive time requires an explicit snapshot resync'
          : 'older replaceable state cannot supersede newer queued state',
      });
    }
    this.#lastOfferedReceiveTimeMs = entry.receiveTimeMs;
    if (entry.mode === 'REPLACEABLE') {
      const existing = this.#entries.findIndex((candidate) => (
        candidate.mode === 'REPLACEABLE' && candidate.coalescingKey === entry.coalescingKey
      ));
      if (existing >= 0) {
        this.#entries.splice(existing, 1);
        this.#entries.push(frozen);
        this.#coalescedCount += 1;
        return Object.freeze({
          accepted: true,
          action: 'COALESCED',
          dropped: 0,
          coalesced: 1,
          requiresResync: this.#resyncRequired,
          reason: 'newer replaceable state superseded the queued state with the same key',
        });
      }
    }

    if (this.#entries.length >= this.#capacity) {
      this.#overflowCount += 1;
      const replaceableIndex = this.#entries.findIndex((candidate) => candidate.mode === 'REPLACEABLE');
      if (replaceableIndex >= 0) {
        this.#entries.splice(replaceableIndex, 1);
        this.#droppedCount += 1;
        this.#entries.push(frozen);
        this.#enqueuedCount += 1;
        this.#highWatermark = Math.max(this.#highWatermark, this.#entries.length);
        return Object.freeze({
          accepted: true,
          action: 'EVICTED_REPLACEABLE',
          dropped: 1,
          coalesced: 0,
          requiresResync: this.#resyncRequired,
          reason: 'oldest replaceable state was shed before protected sequence data',
        });
      }

      this.#droppedCount += 1;
      if (entry.mode === 'SEQUENCE_SENSITIVE') this.#resyncRequired = true;
      return Object.freeze({
        accepted: false,
        action: 'DROPPED',
        dropped: 1,
        coalesced: 0,
        requiresResync: this.#resyncRequired,
        reason: entry.mode === 'SEQUENCE_SENSITIVE'
          ? 'sequence-sensitive overflow requires an explicit snapshot resync'
          : 'queue contained only protected sequence-sensitive entries',
      });
    }

    this.#entries.push(frozen);
    this.#enqueuedCount += 1;
    this.#highWatermark = Math.max(this.#highWatermark, this.#entries.length);
    return Object.freeze({
      accepted: true,
      action: 'ENQUEUED',
      dropped: 0,
      coalesced: 0,
      requiresResync: this.#resyncRequired,
      reason: 'entry queued',
    });
  }

  peek(): Readonly<InboundQueueEntry<T>> | null {
    return this.#entries[0] ?? null;
  }

  shift(): Readonly<InboundQueueEntry<T>> | null {
    const entry = this.#entries.shift() ?? null;
    if (entry !== null) this.#dequeuedCount += 1;
    return entry;
  }

  clear(countAsDropped = true): number {
    const count = this.#entries.length;
    if (countAsDropped && count > 0) {
      this.#droppedCount += count;
      if (this.#entries.some((entry) => entry.mode === 'SEQUENCE_SENSITIVE')) this.#resyncRequired = true;
    }
    this.#entries.length = 0;
    return count;
  }

  acknowledgeResync(): void {
    this.#resyncRequired = false;
  }

  snapshot(): Readonly<BoundedQueueSnapshot> {
    return Object.freeze({
      capacity: this.#capacity,
      depth: this.#entries.length,
      highWatermark: this.#highWatermark,
      enqueuedCount: this.#enqueuedCount,
      dequeuedCount: this.#dequeuedCount,
      droppedCount: this.#droppedCount,
      coalescedCount: this.#coalescedCount,
      overflowCount: this.#overflowCount,
      resyncRequired: this.#resyncRequired,
    });
  }
}
