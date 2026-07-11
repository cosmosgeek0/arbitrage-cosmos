import {
  canonicalJson,
  validateNoSecretFields,
} from '../../intelligenceFoundation/contracts/index.js';
import { boundedJsonByteLength } from '../contracts/index.js';
import type {
  SpotBackpressureSnapshot,
  SpotBufferedMessage,
  SpotBufferOfferResult,
  SpotGenerationDropResult,
} from './types.js';

const SYMBOL_PATTERN = /^[\p{L}\p{N}._-]{1,128}$/u;
const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MAXIMUM_CAPACITY = 16_384;
const MAXIMUM_PAYLOAD_BYTES = 16_777_216;
const MAXIMUM_RETAINED_PAYLOAD_BYTES = 16_777_216;

function safeInteger(value: number, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be a safe integer greater than or equal to ${minimum}`);
  }
  return value;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  const accepted = safeInteger(value, name, minimum);
  if (accepted > maximum) throw new RangeError(`${name} exceeds its hard limit of ${maximum}`);
  return accepted;
}

function cloneMessage(message: SpotBufferedMessage, payload = message.payload): SpotBufferedMessage {
  if (message.kind === 'MINI_TICKER') {
    return {
      kind: 'MINI_TICKER',
      generation: message.generation,
      receiveTimeMs: message.receiveTimeMs,
      payload,
      ...(message.correlationId === undefined ? {} : { correlationId: message.correlationId }),
    };
  }
  return {
    kind: message.kind,
    symbol: message.symbol,
    generation: message.generation,
    receiveTimeMs: message.receiveTimeMs,
    payload,
    ...(message.correlationId === undefined ? {} : { correlationId: message.correlationId }),
  };
}

function validateMessageEnvelope(value: unknown): SpotBufferedMessage {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Spot buffered message must be a plain object');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('Spot buffered message must not contain symbol keys');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.getOwnPropertyNames(value);
  for (const name of names) {
    const descriptor = descriptors[name];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`Spot buffered message field ${name} must be an enumerable data property`);
    }
  }
  const read = (name: string): unknown => descriptors[name]?.value;
  const kind = read('kind');
  if (kind !== 'MINI_TICKER' && kind !== 'BOOK_TICKER' && kind !== 'AGG_TRADE') {
    throw new TypeError('unsupported Spot buffered message kind');
  }
  const allowed = new Set(kind === 'MINI_TICKER'
    ? ['kind', 'generation', 'receiveTimeMs', 'payload', 'correlationId']
    : ['kind', 'symbol', 'generation', 'receiveTimeMs', 'payload', 'correlationId']);
  for (const name of names) {
    if (!allowed.has(name)) throw new TypeError(`Spot buffered message contains unknown field ${name}`);
  }
  for (const required of kind === 'MINI_TICKER'
    ? ['kind', 'generation', 'receiveTimeMs', 'payload']
    : ['kind', 'symbol', 'generation', 'receiveTimeMs', 'payload']) {
    if (!Object.hasOwn(descriptors, required)) throw new TypeError(`Spot buffered message is missing ${required}`);
  }
  const correlationId = read('correlationId');
  if (kind === 'MINI_TICKER') {
    return {
      kind,
      generation: read('generation') as number,
      receiveTimeMs: read('receiveTimeMs') as number,
      payload: read('payload'),
      ...(correlationId === undefined ? {} : { correlationId: correlationId as string }),
    };
  }
  return {
    kind,
    symbol: read('symbol') as string,
    generation: read('generation') as number,
    receiveTimeMs: read('receiveTimeMs') as number,
    payload: read('payload'),
    ...(correlationId === undefined ? {} : { correlationId: correlationId as string }),
  };
}

function replaceableKey(message: SpotBufferedMessage): string | null {
  return message.kind === 'BOOK_TICKER' ? `${message.kind}:${message.generation}:${message.symbol}` : null;
}

/**
 * Pure, caller-driven inbound buffer. Only per-symbol book-ticker state is
 * replaceable. Changed-only mini-ticker arrays and aggregate trades never
 * coalesce because doing so can erase independent source events.
 */
export class SpotBackpressureBuffer {
  readonly #capacity: number;
  readonly #maximumPayloadBytes: number;
  readonly #maximumRetainedPayloadBytes: number;
  readonly #entries: Array<{ key: string | null; message: SpotBufferedMessage; payloadBytes: number }> = [];
  #retainedPayloadBytes = 0;
  #highWaterPayloadBytes = 0;
  #acceptedCount = 0;
  #coalescedCount = 0;
  #droppedCount = 0;
  #capacityDropCount = 0;
  #oversizeDropCount = 0;
  #aggregateByteDropCount = 0;
  #invalidPayloadDropCount = 0;
  #outOfOrderReplacementDropCount = 0;
  #oldGenerationDropCount = 0;
  #miniTickerFrameDropCount = 0;

  constructor(
    capacity: number,
    maximumPayloadBytes = 2_000_000,
    maximumRetainedPayloadBytes?: number,
  ) {
    this.#capacity = boundedInteger(capacity, 'capacity', 1, MAXIMUM_CAPACITY);
    this.#maximumPayloadBytes = boundedInteger(
      maximumPayloadBytes,
      'maximumPayloadBytes',
      1,
      MAXIMUM_PAYLOAD_BYTES,
    );
    const derivedRetainedPayloadBytes = Math.min(
      MAXIMUM_RETAINED_PAYLOAD_BYTES,
      this.#capacity * this.#maximumPayloadBytes,
    );
    this.#maximumRetainedPayloadBytes = boundedInteger(
      maximumRetainedPayloadBytes ?? derivedRetainedPayloadBytes,
      'maximumRetainedPayloadBytes',
      1,
      MAXIMUM_RETAINED_PAYLOAD_BYTES,
    );
  }

  offer(message: SpotBufferedMessage): SpotBufferOfferResult {
    message = validateMessageEnvelope(message);
    if (message.kind !== 'MINI_TICKER' && !SYMBOL_PATTERN.test(message.symbol)) {
      throw new TypeError('buffered Spot symbol is invalid');
    }
    safeInteger(message.generation, 'generation', 1);
    safeInteger(message.receiveTimeMs, 'receiveTimeMs');
    if (message.correlationId !== undefined && !CORRELATION_PATTERN.test(message.correlationId)) {
      this.#recordDrop(message.kind, 'INVALID_PAYLOAD');
      this.#invalidPayloadDropCount += 1;
      return Object.freeze({ state: 'DROPPED', reason: 'INVALID_PAYLOAD', depth: this.#entries.length });
    }
    let payloadBytes: number;
    let serialized: string;
    try {
      payloadBytes = boundedJsonByteLength(message.payload, this.#maximumPayloadBytes);
    } catch (error) {
      if (error instanceof RangeError) {
        this.#recordDrop(message.kind, 'PAYLOAD_TOO_LARGE');
        this.#oversizeDropCount += 1;
        return Object.freeze({ state: 'DROPPED', reason: 'PAYLOAD_TOO_LARGE', depth: this.#entries.length });
      }
      this.#recordDrop(message.kind, 'INVALID_PAYLOAD');
      this.#invalidPayloadDropCount += 1;
      return Object.freeze({ state: 'DROPPED', reason: 'INVALID_PAYLOAD', depth: this.#entries.length });
    }
    const secretCheck = validateNoSecretFields(message.payload, 'intelligence_runtime.spot.buffer');
    if (!secretCheck.ok) {
      this.#recordDrop(message.kind, 'INVALID_PAYLOAD');
      this.#invalidPayloadDropCount += 1;
      return Object.freeze({ state: 'DROPPED', reason: 'INVALID_PAYLOAD', depth: this.#entries.length });
    }
    try {
      serialized = canonicalJson(message.payload);
    } catch {
      this.#recordDrop(message.kind, 'INVALID_PAYLOAD');
      this.#invalidPayloadDropCount += 1;
      return Object.freeze({ state: 'DROPPED', reason: 'INVALID_PAYLOAD', depth: this.#entries.length });
    }
    if (new TextEncoder().encode(serialized).byteLength !== payloadBytes) {
      this.#recordDrop(message.kind, 'INVALID_PAYLOAD');
      this.#invalidPayloadDropCount += 1;
      return Object.freeze({ state: 'DROPPED', reason: 'INVALID_PAYLOAD', depth: this.#entries.length });
    }
    const retainedPayload: unknown = JSON.parse(serialized);

    const key = replaceableKey(message);
    if (key !== null) {
      const existing = this.#entries.findIndex((entry) => entry.key === key);
      if (existing >= 0) {
        const previous = this.#entries[existing]?.message;
        if (previous && message.receiveTimeMs < previous.receiveTimeMs) {
          this.#recordDrop(message.kind, 'OUT_OF_ORDER_REPLACEMENT');
          this.#outOfOrderReplacementDropCount += 1;
          return Object.freeze({ state: 'DROPPED', reason: 'OUT_OF_ORDER_REPLACEMENT', depth: this.#entries.length });
        }
        const previousBytes = this.#entries[existing]?.payloadBytes ?? 0;
        const projectedBytes = this.#retainedPayloadBytes - previousBytes + payloadBytes;
        if (projectedBytes > this.#maximumRetainedPayloadBytes) {
          this.#recordDrop(message.kind, 'AGGREGATE_PAYLOAD_BYTES');
          this.#aggregateByteDropCount += 1;
          return Object.freeze({ state: 'DROPPED', reason: 'AGGREGATE_PAYLOAD_BYTES', depth: this.#entries.length });
        }
        this.#entries.splice(existing, 1);
        this.#entries.push({ key, message: cloneMessage(message, retainedPayload), payloadBytes });
        this.#retainedPayloadBytes = projectedBytes;
        this.#highWaterPayloadBytes = Math.max(this.#highWaterPayloadBytes, projectedBytes);
        this.#coalescedCount += 1;
        return Object.freeze({ state: 'COALESCED', reason: 'REPLACED_STATE', depth: this.#entries.length });
      }
    }

    if (this.#entries.length >= this.#capacity) {
      this.#recordDrop(message.kind, 'CAPACITY');
      this.#capacityDropCount += 1;
      return Object.freeze({ state: 'DROPPED', reason: 'CAPACITY', depth: this.#entries.length });
    }

    if (this.#retainedPayloadBytes + payloadBytes > this.#maximumRetainedPayloadBytes) {
      this.#recordDrop(message.kind, 'AGGREGATE_PAYLOAD_BYTES');
      this.#aggregateByteDropCount += 1;
      return Object.freeze({ state: 'DROPPED', reason: 'AGGREGATE_PAYLOAD_BYTES', depth: this.#entries.length });
    }

    this.#entries.push({ key, message: cloneMessage(message, retainedPayload), payloadBytes });
    this.#retainedPayloadBytes += payloadBytes;
    this.#highWaterPayloadBytes = Math.max(this.#highWaterPayloadBytes, this.#retainedPayloadBytes);
    this.#acceptedCount += 1;
    return Object.freeze({ state: 'ACCEPTED', reason: 'NONE', depth: this.#entries.length });
  }

  drain(maximumItems = this.#capacity): SpotBufferedMessage[] {
    safeInteger(maximumItems, 'maximumItems', 1);
    const count = Math.min(maximumItems, this.#entries.length);
    const drained = this.#entries.splice(0, count);
    this.#retainedPayloadBytes -= drained.reduce((total, entry) => total + entry.payloadBytes, 0);
    return drained.map((entry) => cloneMessage(entry.message));
  }

  dropGenerationsBefore(generation: number): SpotGenerationDropResult {
    safeInteger(generation, 'generation', 1);
    const result = { total: 0, miniTicker: 0, bookTicker: 0, aggregateTrade: 0 };
    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      const entry = this.#entries[index];
      if (!entry || entry.message.generation >= generation) continue;
      this.#entries.splice(index, 1);
      this.#retainedPayloadBytes -= entry.payloadBytes;
      result.total += 1;
      if (entry.message.kind === 'MINI_TICKER') result.miniTicker += 1;
      else if (entry.message.kind === 'BOOK_TICKER') result.bookTicker += 1;
      else result.aggregateTrade += 1;
      this.#recordDrop(entry.message.kind, 'OLD_GENERATION');
      this.#oldGenerationDropCount += 1;
    }
    return Object.freeze(result);
  }

  snapshot(): SpotBackpressureSnapshot {
    return Object.freeze({
      capacity: this.#capacity,
      maximumPayloadBytes: this.#maximumPayloadBytes,
      maximumRetainedPayloadBytes: this.#maximumRetainedPayloadBytes,
      depth: this.#entries.length,
      retainedPayloadBytes: this.#retainedPayloadBytes,
      highWaterPayloadBytes: this.#highWaterPayloadBytes,
      acceptedCount: this.#acceptedCount,
      coalescedCount: this.#coalescedCount,
      droppedCount: this.#droppedCount,
      capacityDropCount: this.#capacityDropCount,
      oversizeDropCount: this.#oversizeDropCount,
      aggregateByteDropCount: this.#aggregateByteDropCount,
      invalidPayloadDropCount: this.#invalidPayloadDropCount,
      outOfOrderReplacementDropCount: this.#outOfOrderReplacementDropCount,
      oldGenerationDropCount: this.#oldGenerationDropCount,
      miniTickerFrameDropCount: this.#miniTickerFrameDropCount,
      replaceableKinds: Object.freeze(['BOOK_TICKER'] as const),
      nonReplaceableKinds: Object.freeze(['MINI_TICKER', 'AGG_TRADE'] as const),
      overflowPolicy: 'DROP_NEW_AND_COUNT',
    });
  }

  #recordDrop(kind: SpotBufferedMessage['kind'], _reason: string): void {
    this.#droppedCount += 1;
    if (kind === 'MINI_TICKER') this.#miniTickerFrameDropCount += 1;
  }
}
