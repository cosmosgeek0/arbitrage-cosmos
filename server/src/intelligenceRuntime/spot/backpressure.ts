import {
  canonicalJson,
  validateNoSecretFields,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  SpotBackpressureSnapshot,
  SpotBufferedMessage,
  SpotBufferOfferResult,
  SpotGenerationDropResult,
} from './types.js';

const SYMBOL_PATTERN = /^[\p{L}\p{N}._-]{1,128}$/u;
const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function safeInteger(value: number, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be a safe integer greater than or equal to ${minimum}`);
  }
  return value;
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
  readonly #entries: Array<{ key: string | null; message: SpotBufferedMessage }> = [];
  #acceptedCount = 0;
  #coalescedCount = 0;
  #droppedCount = 0;
  #capacityDropCount = 0;
  #oversizeDropCount = 0;
  #invalidPayloadDropCount = 0;
  #outOfOrderReplacementDropCount = 0;
  #oldGenerationDropCount = 0;
  #miniTickerFrameDropCount = 0;

  constructor(capacity: number, maximumPayloadBytes = 2_000_000) {
    this.#capacity = safeInteger(capacity, 'capacity', 1);
    this.#maximumPayloadBytes = safeInteger(maximumPayloadBytes, 'maximumPayloadBytes', 1);
  }

  offer(message: SpotBufferedMessage): SpotBufferOfferResult {
    if (!['MINI_TICKER', 'BOOK_TICKER', 'AGG_TRADE'].includes(message.kind)) {
      throw new TypeError('unsupported Spot buffered message kind');
    }
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
    const secretCheck = validateNoSecretFields(message.payload, 'intelligence_runtime.spot.buffer');
    let serialized: string;
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
    if (new TextEncoder().encode(serialized).byteLength > this.#maximumPayloadBytes) {
      this.#recordDrop(message.kind, 'PAYLOAD_TOO_LARGE');
      this.#oversizeDropCount += 1;
      return Object.freeze({ state: 'DROPPED', reason: 'PAYLOAD_TOO_LARGE', depth: this.#entries.length });
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
        this.#entries.splice(existing, 1);
        this.#entries.push({ key, message: cloneMessage(message, retainedPayload) });
        this.#coalescedCount += 1;
        return Object.freeze({ state: 'COALESCED', reason: 'REPLACED_STATE', depth: this.#entries.length });
      }
    }

    if (this.#entries.length >= this.#capacity) {
      this.#recordDrop(message.kind, 'CAPACITY');
      this.#capacityDropCount += 1;
      return Object.freeze({ state: 'DROPPED', reason: 'CAPACITY', depth: this.#entries.length });
    }

    this.#entries.push({ key, message: cloneMessage(message, retainedPayload) });
    this.#acceptedCount += 1;
    return Object.freeze({ state: 'ACCEPTED', reason: 'NONE', depth: this.#entries.length });
  }

  drain(maximumItems = this.#capacity): SpotBufferedMessage[] {
    safeInteger(maximumItems, 'maximumItems', 1);
    const count = Math.min(maximumItems, this.#entries.length);
    return this.#entries.splice(0, count).map((entry) => cloneMessage(entry.message));
  }

  dropGenerationsBefore(generation: number): SpotGenerationDropResult {
    safeInteger(generation, 'generation', 1);
    const result = { total: 0, miniTicker: 0, bookTicker: 0, aggregateTrade: 0 };
    for (let index = this.#entries.length - 1; index >= 0; index -= 1) {
      const entry = this.#entries[index];
      if (!entry || entry.message.generation >= generation) continue;
      this.#entries.splice(index, 1);
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
      depth: this.#entries.length,
      acceptedCount: this.#acceptedCount,
      coalescedCount: this.#coalescedCount,
      droppedCount: this.#droppedCount,
      capacityDropCount: this.#capacityDropCount,
      oversizeDropCount: this.#oversizeDropCount,
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
