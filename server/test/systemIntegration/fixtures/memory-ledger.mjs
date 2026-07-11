import { EventEmitter } from 'node:events';

import { cloneFrozenNullable } from './values.mjs';

const EVENT_KIND_PATTERN = /^[a-z0-9_.-]{1,64}$/;
const CONFIG_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}

function optionalFiniteInteger(value, label) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer when supplied`);
  return value;
}

function freezeEvent(event) {
  return Object.freeze({
    id: event.id,
    ts: event.ts,
    kind: event.kind,
    symbol: event.symbol,
    data: event.data,
  });
}

/**
 * Test-only structural double for the existing Ledger persistence port.
 * It owns no timers, files, sockets, or ambient clock reads.
 */
export class BoundedInMemoryLedger extends EventEmitter {
  #clock;
  #maximumEvents;
  #maximumConfigEntries;
  #maximumConfigValueBytes;
  #maximumEventBytes;
  #events = [];
  #config = new Map();
  #nextEventId = 1;
  #writable = true;
  #closed = false;

  constructor(clock, options = {}) {
    super();
    if (typeof clock?.nowMs !== 'function') throw new TypeError('BoundedInMemoryLedger requires an injected UTC clock');
    const initialNowMs = clock.nowMs();
    if (!Number.isSafeInteger(initialNowMs) || initialNowMs < 0) {
      throw new TypeError('BoundedInMemoryLedger requires an injected UTC clock');
    }
    this.#clock = clock;
    this.#maximumEvents = positiveSafeInteger(options.maximumEvents ?? 2_000, 'maximumEvents');
    this.#maximumConfigEntries = positiveSafeInteger(options.maximumConfigEntries ?? 256, 'maximumConfigEntries');
    this.#maximumConfigValueBytes = positiveSafeInteger(
      options.maximumConfigValueBytes ?? 512 * 1024,
      'maximumConfigValueBytes',
    );
    this.#maximumEventBytes = positiveSafeInteger(options.maximumEventBytes ?? 512 * 1024, 'maximumEventBytes');
    if (options.initialConfig !== undefined) {
      if (options.initialConfig === null || typeof options.initialConfig !== 'object' || Array.isArray(options.initialConfig)) {
        throw new TypeError('initialConfig must be a plain key/value object');
      }
      for (const [key, value] of Object.entries(options.initialConfig)) this.#setConfigValue(key, value);
    }
    Object.seal(this);
  }

  #assertWritable() {
    if (this.#closed) throw new Error('MEMORY_LEDGER_CLOSED');
    if (!this.#writable) throw new Error('MEMORY_LEDGER_NOT_WRITABLE');
  }

  #setConfigValue(key, value) {
    if (typeof key !== 'string' || !CONFIG_KEY_PATTERN.test(key)) throw new TypeError('invalid memory-ledger config key');
    if (typeof value !== 'string') throw new TypeError('memory-ledger config value must be a string');
    if (Buffer.byteLength(value, 'utf8') > this.#maximumConfigValueBytes) {
      throw new RangeError('memory-ledger config value exceeds maximumConfigValueBytes');
    }
    if (!this.#config.has(key) && this.#config.size >= this.#maximumConfigEntries) {
      throw new RangeError('memory-ledger config capacity exceeded');
    }
    this.#config.set(key, value);
  }

  #prepareEvent(kind, symbol, data) {
    if (typeof kind !== 'string' || !EVENT_KIND_PATTERN.test(kind)) throw new TypeError('invalid memory-ledger event kind');
    if (symbol !== null && symbol !== undefined && (typeof symbol !== 'string' || symbol.length > 64)) {
      throw new TypeError('invalid memory-ledger event symbol');
    }
    if (this.#events.length >= this.#maximumEvents) throw new RangeError('memory-ledger event capacity exceeded');
    const frozenData = cloneFrozenNullable(data, { maximumBytes: this.#maximumEventBytes });
    const ts = this.#clock.nowMs();
    if (!Number.isSafeInteger(ts) || ts < 0) throw new TypeError('memory-ledger clock returned invalid UTC milliseconds');
    return freezeEvent({
      id: this.#nextEventId,
      ts,
      kind,
      symbol: symbol ?? null,
      data: frozenData,
    });
  }

  #commitEvent(event) {
    this.#events.push(event);
    this.#nextEventId += 1;
    try {
      this.emit('event', event);
    } catch {
      // Match the production ledger: a post-commit listener cannot undo truth.
    }
    return event;
  }

  getConfigValue(key) {
    if (typeof key !== 'string') throw new TypeError('memory-ledger config key must be a string');
    return this.#config.get(key) ?? null;
  }

  /** Setup-only helper. Production adapters should use the atomic method below. */
  seedConfigValue(key, value) {
    if (this.#events.length > 0) throw new Error('memory-ledger config seeding is closed after the first event');
    this.#assertWritable();
    this.#setConfigValue(key, value);
  }

  logEvent(kind, symbol = null, data = null) {
    this.#assertWritable();
    return this.#commitEvent(this.#prepareEvent(kind, symbol, data));
  }

  setConfigValueAndLogEvent(key, value, kind, symbol = null, data = null) {
    this.#assertWritable();
    // Validate both halves before mutating either half.
    const event = this.#prepareEvent(kind, symbol, data);
    if (typeof key !== 'string' || !CONFIG_KEY_PATTERN.test(key)) throw new TypeError('invalid memory-ledger config key');
    if (typeof value !== 'string') throw new TypeError('memory-ledger config value must be a string');
    if (Buffer.byteLength(value, 'utf8') > this.#maximumConfigValueBytes) {
      throw new RangeError('memory-ledger config value exceeds maximumConfigValueBytes');
    }
    if (!this.#config.has(key) && this.#config.size >= this.#maximumConfigEntries) {
      throw new RangeError('memory-ledger config capacity exceeded');
    }
    this.#config.set(key, value);
    return this.#commitEvent(event);
  }

  recentEvents(
    limit = 100,
    kind,
    symbol,
    q,
    since,
    beforeId,
    until,
    offset = 0,
    afterId,
  ) {
    const safeLimit = Math.min(2_000, Math.max(1, positiveSafeInteger(limit, 'limit')));
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('offset must be a non-negative safe integer');
    const safeSince = optionalFiniteInteger(since, 'since');
    const safeBeforeId = optionalFiniteInteger(beforeId, 'beforeId');
    const safeUntil = optionalFiniteInteger(until, 'until');
    const safeAfterId = optionalFiniteInteger(afterId, 'afterId');
    if (kind !== undefined && typeof kind !== 'string') throw new TypeError('kind must be a string when supplied');
    if (symbol !== undefined && typeof symbol !== 'string') throw new TypeError('symbol must be a string when supplied');
    if (q !== undefined && (typeof q !== 'string' || q.length > 64)) throw new TypeError('q must be a bounded string');
    const needle = q?.trim().toLowerCase();
    const filtered = this.#events.filter((event) => {
      if (kind && event.kind !== kind) return false;
      if (symbol && event.symbol !== symbol) return false;
      if (safeSince !== undefined && event.ts < safeSince) return false;
      if (safeUntil !== undefined && event.ts >= safeUntil) return false;
      if (safeBeforeId !== undefined && event.id >= safeBeforeId) return false;
      if (safeAfterId !== undefined && event.id <= safeAfterId) return false;
      if (needle) {
        const searchable = `${event.kind}\n${event.symbol ?? ''}\n${JSON.stringify(event.data)}`.toLowerCase();
        if (!searchable.includes(needle)) return false;
      }
      return true;
    });
    filtered.sort((left, right) => safeAfterId === undefined ? right.id - left.id : left.id - right.id);
    return Object.freeze(filtered.slice(offset, offset + safeLimit));
  }

  countEvents(kind, symbol) {
    return this.#events.filter((event) => (!kind || event.kind === kind) && (!symbol || event.symbol === symbol)).length;
  }

  eventsSnapshot() {
    return Object.freeze([...this.#events]);
  }

  get events() {
    return this.eventsSnapshot();
  }

  configSnapshot() {
    return Object.freeze(Object.fromEntries([...this.#config.entries()].sort(([left], [right]) => left.localeCompare(right))));
  }

  probeWritable() {
    return !this.#closed && this.#writable;
  }

  setWritable(writable) {
    if (typeof writable !== 'boolean') throw new TypeError('setWritable requires a boolean');
    if (this.#closed && writable) throw new Error('closed memory ledger cannot become writable');
    this.#writable = writable;
  }

  close() {
    this.#closed = true;
    this.#writable = false;
  }
}
