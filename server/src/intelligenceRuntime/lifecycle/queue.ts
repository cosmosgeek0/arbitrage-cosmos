import { canonicalJson } from '../../intelligenceFoundation/contracts/index.js';

export type InboundQueueMode = 'REPLACEABLE' | 'SEQUENCE_SENSITIVE';

const DEFAULT_MAXIMUM_ENTRY_BYTES = 1024 * 1024;
const HARD_MAXIMUM_ENTRY_BYTES = 64 * 1024 * 1024 + 64 * 1024;
const HARD_MAXIMUM_RETAINED_BYTES = 512 * 1024 * 1024;
const MAXIMUM_ENTRY_ENVELOPE_BYTES = 8 * 1024;
const MAXIMUM_JSON_DEPTH = 64;
const MAXIMUM_JSON_NODES = 100_000;
const encoder = new TextEncoder();

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
  maximumEntryBytes: number;
  maximumRetainedBytes: number;
  retainedBytes: number;
  highWatermarkRetainedBytes: number;
  depth: number;
  highWatermark: number;
  enqueuedCount: number;
  dequeuedCount: number;
  droppedCount: number;
  coalescedCount: number;
  overflowCount: number;
  oversizeDropCount: number;
  resyncRequired: boolean;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function deepFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreezeJson(child);
  return Object.freeze(value);
}

function validateJsonDescriptors(
  value: unknown,
  depth = 0,
  ancestors = new Set<object>(),
  budget = { nodes: 0 },
): void {
  if (depth > MAXIMUM_JSON_DEPTH) throw new TypeError('queue entry value exceeds maximum JSON depth');
  budget.nodes += 1;
  if (budget.nodes > MAXIMUM_JSON_NODES) throw new TypeError('queue entry value exceeds maximum JSON nodes');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('queue entry value contains a non-finite number');
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`queue entry value contains unsupported ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError('queue entry value contains a cycle');
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('queue entry value must contain only plain JSON objects');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('queue entry value cannot contain symbol keys');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  ancestors.add(value);
  if (isArray) {
    if (value.length > MAXIMUM_JSON_NODES) throw new TypeError('queue entry array exceeds maximum JSON nodes');
    const expected = new Set(['length', ...Array.from({ length: value.length }, (_, index) => String(index))]);
    if (Object.keys(descriptors).some((key) => !expected.has(key))) {
      throw new TypeError('queue entry arrays cannot contain custom properties');
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('queue entry arrays must be dense data-only values');
      }
      validateJsonDescriptors(descriptor.value, depth + 1, ancestors, budget);
    }
  } else {
    const keys = Object.keys(descriptors);
    if (keys.length > MAXIMUM_JSON_NODES) throw new TypeError('queue entry object exceeds maximum JSON nodes');
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('queue entry objects must contain enumerable data properties only');
      }
      validateJsonDescriptors(descriptor.value, depth + 1, ancestors, budget);
    }
  }
  ancestors.delete(value);
}

/**
 * Detaches a JSON-shaped decoded value from its producer and rejects it before
 * retention when its canonical UTF-8 representation exceeds the hard caller
 * budget. Descriptor validation runs before property access, so accessors,
 * cycles, custom/symbol keys, non-plain objects, and non-finite values fail
 * closed without executing caller code.
 */
function cloneAndMeasureBoundedQueueValue<T>(value: T, maximumBytes: number): { value: T; bytes: number } {
  const boundedMaximum = positiveInteger(maximumBytes, 'queue maximum entry bytes');
  if (boundedMaximum > HARD_MAXIMUM_ENTRY_BYTES) {
    throw new RangeError('queue maximum entry bytes exceeds the hard safety bound');
  }
  validateJsonDescriptors(value);
  const serialized = canonicalJson(value);
  const bytes = encoder.encode(serialized).byteLength;
  if (bytes > boundedMaximum) {
    throw new RangeError('queue entry value exceeds maximumEntryBytes');
  }
  return { value: deepFreezeJson(JSON.parse(serialized) as T), bytes };
}

export function cloneBoundedQueueValue<T>(value: T, maximumBytes: number): T {
  return cloneAndMeasureBoundedQueueValue(value, maximumBytes).value;
}

function validateEntry<T>(entry: InboundQueueEntry<T>): InboundQueueEntry<T> {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new TypeError('queue entry is required');
  const prototype = Object.getPrototypeOf(entry);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('queue entry must be a plain object');
  const allowed = ['id', 'mode', 'coalescingKey', 'receiveTimeMs', 'value'] as const;
  const descriptors = Object.getOwnPropertyDescriptors(entry);
  if (Object.getOwnPropertySymbols(entry).length > 0
    || Object.keys(descriptors).length !== allowed.length
    || Object.keys(descriptors).some((key) => !(allowed as readonly string[]).includes(key))) {
    throw new TypeError('queue entry contains unsupported fields');
  }
  for (const key of allowed) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`queue entry ${key} must be an enumerable data property`);
    }
  }
  const value: InboundQueueEntry<T> = {
    id: descriptors.id?.value as string,
    mode: descriptors.mode?.value as InboundQueueMode,
    coalescingKey: descriptors.coalescingKey?.value as string | null,
    receiveTimeMs: descriptors.receiveTimeMs?.value as number,
    value: descriptors.value?.value as T,
  };
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 512) {
    throw new TypeError('queue entry id must be a bounded non-empty string');
  }
  if (value.mode !== 'REPLACEABLE' && value.mode !== 'SEQUENCE_SENSITIVE') throw new TypeError('queue mode is invalid');
  if (!Number.isSafeInteger(value.receiveTimeMs) || value.receiveTimeMs < 0) throw new TypeError('queue receive time is invalid');
  if (value.mode === 'REPLACEABLE'
    && (typeof value.coalescingKey !== 'string' || value.coalescingKey.length === 0 || value.coalescingKey.length > 512)) {
    throw new TypeError('replaceable queue entries require a bounded coalescing key');
  }
  return value;
}

/**
 * Bounded FIFO with explicit state coalescing. Sequence-sensitive entries are
 * never coalesced or evicted; overflow instead raises a resync requirement.
 */
export class BoundedInboundQueue<T> {
  readonly #capacity: number;
  readonly #maximumEntryBytes: number;
  readonly #maximumRetainedBytes: number;
  readonly #entries: Array<{ entry: Readonly<InboundQueueEntry<T>>; retainedBytes: number }> = [];
  #retainedBytes = 0;
  #highWatermarkRetainedBytes = 0;
  #highWatermark = 0;
  #enqueuedCount = 0;
  #dequeuedCount = 0;
  #droppedCount = 0;
  #coalescedCount = 0;
  #overflowCount = 0;
  #oversizeDropCount = 0;
  #resyncRequired = false;
  #lastOfferedReceiveTimeMs: number | null = null;

  constructor(
    capacity: number,
    maximumEntryBytes = DEFAULT_MAXIMUM_ENTRY_BYTES,
    maximumRetainedBytes = Math.min(
      HARD_MAXIMUM_RETAINED_BYTES,
      capacity * (maximumEntryBytes + MAXIMUM_ENTRY_ENVELOPE_BYTES),
    ),
  ) {
    this.#capacity = positiveInteger(capacity, 'queue capacity');
    if (capacity > 1_000_000) throw new RangeError('queue capacity exceeds the hard safety bound');
    this.#maximumEntryBytes = positiveInteger(maximumEntryBytes, 'queue maximum entry bytes');
    if (this.#maximumEntryBytes > HARD_MAXIMUM_ENTRY_BYTES) {
      throw new RangeError('queue maximum entry bytes exceeds the hard safety bound');
    }
    this.#maximumRetainedBytes = positiveInteger(maximumRetainedBytes, 'queue maximum retained bytes');
    if (this.#maximumRetainedBytes > HARD_MAXIMUM_RETAINED_BYTES) {
      throw new RangeError('queue maximum retained bytes exceeds the hard safety bound');
    }
  }

  offer(entry: InboundQueueEntry<T>): Readonly<QueueOfferResult> {
    entry = validateEntry(entry);
    let retained;
    try {
      retained = cloneAndMeasureBoundedQueueValue(entry.value, this.#maximumEntryBytes);
    } catch (cause) {
      if (!(cause instanceof RangeError) || !cause.message.includes('maximumEntryBytes')) throw cause;
      this.#droppedCount += 1;
      this.#oversizeDropCount += 1;
      if (entry.mode === 'SEQUENCE_SENSITIVE') this.#resyncRequired = true;
      return Object.freeze({
        accepted: false,
        action: 'DROPPED',
        dropped: 1,
        coalesced: 0,
        requiresResync: this.#resyncRequired,
        reason: 'entry value exceeds the queue per-entry byte bound',
      });
    }
    const retainedValue = retained.value;
    const frozen = Object.freeze({
      id: entry.id,
      mode: entry.mode,
      coalescingKey: entry.mode === 'REPLACEABLE' ? entry.coalescingKey : null,
      receiveTimeMs: entry.receiveTimeMs,
      value: retainedValue,
    });
    const retainedEntryBytes = encoder.encode(canonicalJson(frozen)).byteLength;
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
    const coalescedIndex = entry.mode === 'REPLACEABLE'
      ? this.#entries.findIndex((candidate) => (
        candidate.entry.mode === 'REPLACEABLE' && candidate.entry.coalescingKey === entry.coalescingKey
      ))
      : -1;
    const removed = new Set<number>();
    if (coalescedIndex >= 0) removed.add(coalescedIndex);
    let retainedAfterRemoval = this.#retainedBytes
      - (coalescedIndex >= 0 ? (this.#entries[coalescedIndex]?.retainedBytes ?? 0) : 0);
    let countAfterRemoval = this.#entries.length - removed.size;
    const needsRoom = (): boolean => countAfterRemoval + 1 > this.#capacity
      || retainedAfterRemoval + retainedEntryBytes > this.#maximumRetainedBytes;
    for (let index = 0; needsRoom() && index < this.#entries.length; index += 1) {
      if (removed.has(index)) continue;
      const candidate = this.#entries[index];
      if (!candidate || candidate.entry.mode !== 'REPLACEABLE') continue;
      removed.add(index);
      retainedAfterRemoval -= candidate.retainedBytes;
      countAfterRemoval -= 1;
    }
    const evictedCount = removed.size - (coalescedIndex >= 0 ? 1 : 0);
    if (needsRoom()) {
      this.#overflowCount += 1;
      this.#droppedCount += 1;
      if (entry.mode === 'SEQUENCE_SENSITIVE') this.#resyncRequired = true;
      return Object.freeze({
        accepted: false,
        action: 'DROPPED',
        dropped: 1,
        coalesced: 0,
        requiresResync: this.#resyncRequired,
        reason: entry.mode === 'SEQUENCE_SENSITIVE'
          ? 'sequence-sensitive count or byte overflow requires an explicit snapshot resync'
          : 'queue contained only protected sequence-sensitive entries within the remaining byte budget',
      });
    }
    if (removed.size > 0) {
      this.#entries.splice(0, this.#entries.length, ...this.#entries.filter((_candidate, index) => !removed.has(index)));
      this.#retainedBytes = retainedAfterRemoval;
    }
    this.#entries.push({ entry: frozen, retainedBytes: retainedEntryBytes });
    this.#retainedBytes += retainedEntryBytes;
    this.#highWatermarkRetainedBytes = Math.max(this.#highWatermarkRetainedBytes, this.#retainedBytes);
    if (coalescedIndex >= 0) this.#coalescedCount += 1;
    if (evictedCount > 0) {
      this.#overflowCount += 1;
      this.#droppedCount += evictedCount;
    }
    if (coalescedIndex < 0) this.#enqueuedCount += 1;
    this.#highWatermark = Math.max(this.#highWatermark, this.#entries.length);
    if (evictedCount > 0) return Object.freeze({
      accepted: true,
      action: 'EVICTED_REPLACEABLE',
      dropped: evictedCount,
      coalesced: coalescedIndex >= 0 ? 1 : 0,
      requiresResync: this.#resyncRequired,
      reason: 'oldest replaceable state was shed before protected sequence data or the aggregate byte bound',
    });
    if (coalescedIndex >= 0) return Object.freeze({
      accepted: true,
      action: 'COALESCED',
      dropped: 0,
      coalesced: 1,
      requiresResync: this.#resyncRequired,
      reason: 'newer replaceable state superseded the queued state with the same key',
    });
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
    return this.#entries[0]?.entry ?? null;
  }

  shift(): Readonly<InboundQueueEntry<T>> | null {
    const retained = this.#entries.shift() ?? null;
    if (retained !== null) {
      this.#retainedBytes -= retained.retainedBytes;
      this.#dequeuedCount += 1;
    }
    return retained?.entry ?? null;
  }

  clear(countAsDropped = true): number {
    const count = this.#entries.length;
    if (countAsDropped && count > 0) {
      this.#droppedCount += count;
      if (this.#entries.some((entry) => entry.entry.mode === 'SEQUENCE_SENSITIVE')) this.#resyncRequired = true;
    }
    this.#entries.length = 0;
    this.#retainedBytes = 0;
    return count;
  }

  acknowledgeResync(): void {
    this.#resyncRequired = false;
  }

  snapshot(): Readonly<BoundedQueueSnapshot> {
    return Object.freeze({
      capacity: this.#capacity,
      maximumEntryBytes: this.#maximumEntryBytes,
      maximumRetainedBytes: this.#maximumRetainedBytes,
      retainedBytes: this.#retainedBytes,
      highWatermarkRetainedBytes: this.#highWatermarkRetainedBytes,
      depth: this.#entries.length,
      highWatermark: this.#highWatermark,
      enqueuedCount: this.#enqueuedCount,
      dequeuedCount: this.#dequeuedCount,
      droppedCount: this.#droppedCount,
      coalescedCount: this.#coalescedCount,
      overflowCount: this.#overflowCount,
      oversizeDropCount: this.#oversizeDropCount,
      resyncRequired: this.#resyncRequired,
    });
  }
}
