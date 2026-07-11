import { createHash } from 'node:crypto';
import {
  canonicalJson,
  makeStableFailure,
  stableId,
  validateInstrumentIdentity,
  validateNoSecretFields,
  type InstrumentIdentity,
  type NormalizedBookTicker,
  type NormalizedTrade,
  type StableFailure,
} from '../../intelligenceFoundation/contracts/index.js';
import {
  normalizeBookTicker,
  normalizeTrade,
} from '../../intelligenceFoundation/evidence/index.js';
import type { NormalizationContext } from '../../intelligenceFoundation/evidence/index.js';
import {
  boundedJsonByteLength,
  SourceLifecycleTracker,
  sourceDefinition,
  type RuntimeClock,
  type RuntimeSourceDefinition,
  type RuntimeSourceEvent,
} from '../contracts/index.js';
import { SpotBackpressureBuffer } from './backpressure.js';
import type {
  SpotBufferedMessage,
  SpotBufferOfferResult,
  SpotEvidenceIngestResult,
  SpotFrameIngestResult,
  SpotFreshnessState,
  SpotReducerPolicy,
  SpotRolling24hObservation,
  SpotRuntimeSnapshot,
  SpotSourceMetrics,
  SpotSymbolSnapshot,
  SpotUniverseCoverageSnapshot,
} from './types.js';

const SOURCE_ID = 'binance-spot-market-stream' as const;
const DATASET = 'spot.rolling_24h_mini_ticker' as const;
export const SPOT_SOURCE_KINDS = Object.freeze(['MINI_TICKER', 'BOOK_TICKER', 'AGG_TRADE'] as const);
export type SpotSourceKind = (typeof SPOT_SOURCE_KINDS)[number];
export const SPOT_SOURCE_STREAMS: Readonly<Record<SpotSourceKind, string>> = Object.freeze({
  MINI_TICKER: '!miniTicker@arr',
  BOOK_TICKER: '<symbol>@bookTicker',
  AGG_TRADE: '<symbol>@aggTrade',
});
const SYMBOL_PATTERN = /^[\p{L}\p{N}._-]{1,128}$/u;
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const MAXIMUM_INSTRUMENT_BYTES = 16 * 1024;
const POLICY_KEYS = Object.freeze([
  'configurationVersion',
  'maximumSymbols',
  'maximumFrameRecords',
  'maximumRecentTradesPerSymbol',
  'maximumFutureSkewMs',
  'tickerMaximumAgeMs',
  'bookMaximumAgeMs',
  'tradeMaximumAgeMs',
  'sourceSilentAfterMs',
  'sourceStaleAfterMs',
  'sourceGapAfterMs',
  'bookSourceSilentAfterMs',
  'bookSourceStaleAfterMs',
  'tradeSourceSilentAfterMs',
  'tradeSourceStaleAfterMs',
  'inboundCapacity',
  'maximumBufferedPayloadBytes',
] as const satisfies readonly (keyof SpotReducerPolicy)[]);
const POLICY_KEY_SET = new Set<string>(POLICY_KEYS);

export const DEFAULT_SPOT_REDUCER_POLICY: Readonly<SpotReducerPolicy> = Object.freeze({
  configurationVersion: 'spot-runtime-1',
  maximumSymbols: 10_000,
  maximumFrameRecords: 10_000,
  maximumRecentTradesPerSymbol: 64,
  maximumFutureSkewMs: 2_000,
  tickerMaximumAgeMs: 30_000,
  bookMaximumAgeMs: 5_000,
  tradeMaximumAgeMs: 5_000,
  sourceSilentAfterMs: 3_000,
  sourceStaleAfterMs: 10_000,
  sourceGapAfterMs: 3_000,
  bookSourceSilentAfterMs: 7_500,
  bookSourceStaleAfterMs: 15_000,
  tradeSourceSilentAfterMs: 7_500,
  tradeSourceStaleAfterMs: 15_000,
  inboundCapacity: 4_096,
  maximumBufferedPayloadBytes: 2_000_000,
});

export const SPOT_REDUCER_POLICY_LIMITS: Readonly<Record<Exclude<keyof SpotReducerPolicy, 'configurationVersion'>, number>> = Object.freeze({
  maximumSymbols: 20_000,
  maximumFrameRecords: 50_000,
  maximumRecentTradesPerSymbol: 256,
  maximumFutureSkewMs: 60_000,
  tickerMaximumAgeMs: 86_400_000,
  bookMaximumAgeMs: 86_400_000,
  tradeMaximumAgeMs: 86_400_000,
  sourceSilentAfterMs: 86_400_000,
  sourceStaleAfterMs: 86_400_000,
  sourceGapAfterMs: 86_400_000,
  bookSourceSilentAfterMs: 86_400_000,
  bookSourceStaleAfterMs: 86_400_000,
  tradeSourceSilentAfterMs: 86_400_000,
  tradeSourceStaleAfterMs: 86_400_000,
  inboundCapacity: 16_384,
  maximumBufferedPayloadBytes: 16_777_216,
});

interface SymbolState {
  instrument: InstrumentIdentity;
  ticker24h: SpotRolling24hObservation | null;
  tickerFingerprint: string | null;
  bookTicker: NormalizedBookTicker | null;
  recentTrades: NormalizedTrade[];
  lastAggregateTradeId: string | null;
  lastTradeSequence: string | null;
}

interface ParsedMiniTicker {
  symbol: string;
  eventTimeMs: number;
  lastPrice: number;
  openPrice24h: number;
  highPrice24h: number;
  lowPrice24h: number;
  baseVolume24h: number;
  quoteVolume24h: number;
  fingerprint: string;
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeInteger(value: unknown, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${name} must be a safe integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function strictDecimal(value: unknown, name: string, positive: boolean): number {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && !DECIMAL_PATTERN.test(value))) {
    throw new TypeError(`${name} must be a strict decimal value`);
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || (positive ? parsed <= 0 : parsed < 0)) {
    throw new TypeError(`${name} must be ${positive ? 'positive' : 'non-negative'}`);
  }
  return Object.is(parsed, -0) ? 0 : parsed;
}

function validatePolicy(overrides: Partial<SpotReducerPolicy>): Readonly<SpotReducerPolicy> {
  if (!isRecord(overrides) || Object.getPrototypeOf(overrides) !== Object.prototype) {
    throw new TypeError('Spot reducer policy overrides must be a plain object');
  }
  if (Object.getOwnPropertySymbols(overrides).length > 0) {
    throw new TypeError('Spot reducer policy overrides must not contain symbol keys');
  }
  const descriptors = Object.getOwnPropertyDescriptors(overrides);
  const policy = { ...DEFAULT_SPOT_REDUCER_POLICY } as SpotReducerPolicy;
  for (const name of Object.getOwnPropertyNames(overrides)) {
    if (!POLICY_KEY_SET.has(name)) throw new TypeError(`Spot reducer policy contains unknown field ${name}`);
    const descriptor = descriptors[name];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`Spot reducer policy field ${name} must be an enumerable data property`);
    }
    (policy as unknown as Record<string, unknown>)[name] = descriptor.value;
  }
  if (
    typeof policy.configurationVersion !== 'string'
    || policy.configurationVersion.trim().length === 0
    || policy.configurationVersion.length > 128
  ) {
    throw new TypeError('configurationVersion must be a non-empty string no longer than 128 characters');
  }
  for (const [name, value, minimum] of [
    ['maximumSymbols', policy.maximumSymbols, 1],
    ['maximumFrameRecords', policy.maximumFrameRecords, 1],
    ['maximumRecentTradesPerSymbol', policy.maximumRecentTradesPerSymbol, 1],
    ['maximumFutureSkewMs', policy.maximumFutureSkewMs, 0],
    ['tickerMaximumAgeMs', policy.tickerMaximumAgeMs, 1],
    ['bookMaximumAgeMs', policy.bookMaximumAgeMs, 1],
    ['tradeMaximumAgeMs', policy.tradeMaximumAgeMs, 1],
    ['sourceSilentAfterMs', policy.sourceSilentAfterMs, 1],
    ['sourceStaleAfterMs', policy.sourceStaleAfterMs, 1],
    ['sourceGapAfterMs', policy.sourceGapAfterMs, 1],
    ['bookSourceSilentAfterMs', policy.bookSourceSilentAfterMs, 1],
    ['bookSourceStaleAfterMs', policy.bookSourceStaleAfterMs, 1],
    ['tradeSourceSilentAfterMs', policy.tradeSourceSilentAfterMs, 1],
    ['tradeSourceStaleAfterMs', policy.tradeSourceStaleAfterMs, 1],
    ['inboundCapacity', policy.inboundCapacity, 1],
    ['maximumBufferedPayloadBytes', policy.maximumBufferedPayloadBytes, 1],
  ] as const) {
    safeInteger(value, name, minimum);
    const maximum = SPOT_REDUCER_POLICY_LIMITS[name];
    if (value > maximum) throw new TypeError(`${name} exceeds its hard limit of ${maximum}`);
  }
  if (policy.sourceStaleAfterMs < policy.sourceSilentAfterMs) {
    throw new TypeError('sourceStaleAfterMs must not be below sourceSilentAfterMs');
  }
  if (policy.bookSourceStaleAfterMs < policy.bookSourceSilentAfterMs) {
    throw new TypeError('bookSourceStaleAfterMs must not be below bookSourceSilentAfterMs');
  }
  if (policy.tradeSourceStaleAfterMs < policy.tradeSourceSilentAfterMs) {
    throw new TypeError('tradeSourceStaleAfterMs must not be below tradeSourceSilentAfterMs');
  }
  return Object.freeze(policy);
}

function failure(code: StableFailure['code'], message: string, field: string | null): StableFailure {
  return makeStableFailure(code, 'intelligence_runtime.spot', message, field);
}

function identityToken(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return value === undefined ? null : typeof value;
}

function symbolIdentityToken(value: unknown): string {
  if (typeof value === 'string' && SYMBOL_PATTERN.test(value)) return value;
  return typeof value === 'string' ? `INVALID_STRING_LENGTH:${value.length}` : `INVALID_TYPE:${typeof value}`;
}

function bufferedMessageRoute(value: SpotBufferedMessage): { kind: SpotSourceKind; generation: number } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Spot buffered message must be an object');
  }
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, 'kind');
  const generationDescriptor = Object.getOwnPropertyDescriptor(value, 'generation');
  if (!kindDescriptor?.enumerable || !Object.hasOwn(kindDescriptor, 'value')) {
    throw new TypeError('Spot buffered message kind must be an enumerable data property');
  }
  if (!generationDescriptor?.enumerable || !Object.hasOwn(generationDescriptor, 'value')) {
    throw new TypeError('Spot buffered message generation must be an enumerable data property');
  }
  if (!SPOT_SOURCE_KINDS.includes(kindDescriptor.value as SpotSourceKind)) {
    throw new TypeError('unsupported Spot buffered message kind');
  }
  return { kind: kindDescriptor.value as SpotSourceKind, generation: generationDescriptor.value as number };
}

function sourceEventIdentity(payload: unknown): Record<string, string | number | boolean | null> {
  if (!isRecord(payload)) return { payloadType: Array.isArray(payload) ? 'array' : typeof payload };
  return {
    eventType: identityToken(payload.e),
    eventTime: identityToken(payload.E),
    transactionTime: identityToken(payload.T),
    symbol: identityToken(payload.s ?? payload.symbol),
    updateId: identityToken(payload.u),
    aggregateId: identityToken(payload.a),
    firstId: identityToken(payload.f),
    lastId: identityToken(payload.l),
  };
}

/**
 * Hashes each official source record independently so an all-market array does
 * not consume the canonicalizer's aggregate node budget. The inbound transport
 * applies a byte bound, while this streaming digest still covers the entire
 * frame (including records that the reducer subsequently drops by record cap).
 */
function payloadDigest(payload: unknown): string {
  const hash = createHash('sha256');
  hash.update('single\0');
  hash.update(canonicalJson(payload));
  return hash.digest('hex');
}

interface AdmittedMiniTickerFrame {
  receivedRecords: number;
  droppedRecords: number;
  records: readonly unknown[];
  prefixDigest: string;
}

/** Reads and authenticates only the configured prefix; overflow slots are never inspected. */
function admitMiniTickerFrame(
  payload: unknown,
  maximumFrameRecords: number,
  maximumPayloadBytes: number,
): AdmittedMiniTickerFrame {
  if (!Array.isArray(payload)) throw new TypeError('Spot mini-ticker payload must be an array');
  const receivedRecords = payload.length;
  const admittedRecords = Math.min(receivedRecords, maximumFrameRecords);
  let measuredBytes = 2;
  if (measuredBytes > maximumPayloadBytes) throw new RangeError('Spot mini-ticker prefix exceeds maximumBufferedPayloadBytes');
  const hash = createHash('sha256');
  hash.update('bounded-prefix\0');
  hash.update(String(admittedRecords));
  hash.update('\0');
  const records: unknown[] = [];
  for (let index = 0; index < admittedRecords; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(payload, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`Spot mini-ticker payload[${index}] must be a dense data property`);
    }
    const delimiterBytes = index === 0 ? 0 : 1;
    const remainingBytes = maximumPayloadBytes - measuredBytes - delimiterBytes - 1;
    if (remainingBytes < 1) throw new RangeError('Spot mini-ticker prefix exceeds maximumBufferedPayloadBytes');
    const recordBytes = boundedJsonByteLength(descriptor.value, remainingBytes);
    measuredBytes += delimiterBytes + recordBytes;
    records.push(descriptor.value);
    hash.update(String(index));
    hash.update('\0');
    hash.update(canonicalJson(descriptor.value));
    hash.update('\0');
  }
  return Object.freeze({
    receivedRecords,
    droppedRecords: receivedRecords - admittedRecords,
    records: Object.freeze(records),
    prefixDigest: hash.digest('hex'),
  });
}

function resolveCorrelationId(
  provided: string | undefined,
  identity: Record<string, unknown>,
): string {
  if (provided !== undefined) {
    if (typeof provided !== 'string' || !CORRELATION_PATTERN.test(provided)) {
      throw new TypeError('correlationId must be a bounded stable token');
    }
    return provided;
  }
  return stableId('runtime-correlation', identity);
}

function cloneInstrument(value: InstrumentIdentity): InstrumentIdentity {
  return Object.freeze({ ...value });
}

function parseMiniTicker(raw: unknown): ParsedMiniTicker {
  const secret = validateNoSecretFields(raw, 'intelligence_runtime.spot.mini_ticker');
  if (!secret.ok) throw new TypeError(secret.failure.message);
  if (!isRecord(raw)) throw new TypeError('mini-ticker record must be an object');
  if (raw.e !== '24hrMiniTicker') throw new TypeError('mini-ticker event type is invalid');
  if (typeof raw.s !== 'string' || !SYMBOL_PATTERN.test(raw.s)) throw new TypeError('mini-ticker symbol is invalid');
  const eventTimeMs = safeInteger(raw.E, 'mini-ticker event time');
  const lastPrice = strictDecimal(raw.c, 'mini-ticker last price', true);
  const openPrice24h = strictDecimal(raw.o, 'mini-ticker open price', true);
  const highPrice24h = strictDecimal(raw.h, 'mini-ticker high price', true);
  const lowPrice24h = strictDecimal(raw.l, 'mini-ticker low price', true);
  const baseVolume24h = strictDecimal(raw.v, 'mini-ticker 24h base volume', false);
  const quoteVolume24h = strictDecimal(raw.q, 'mini-ticker 24h quote volume', false);
  if (lowPrice24h > highPrice24h || lastPrice < lowPrice24h || lastPrice > highPrice24h) {
    throw new TypeError('mini-ticker price range is inconsistent');
  }
  return {
    symbol: raw.s,
    eventTimeMs,
    lastPrice,
    openPrice24h,
    highPrice24h,
    lowPrice24h,
    baseVolume24h,
    quoteVolume24h,
    fingerprint: canonicalJson({
      symbol: raw.s,
      eventTimeMs,
      lastPrice,
      openPrice24h,
      highPrice24h,
      lowPrice24h,
      baseVolume24h,
      quoteVolume24h,
    }),
  };
}

function freshness(observedAtMs: number | null, maximumAgeMs: number, atMs: number): SpotFreshnessState {
  if (observedAtMs === null) return 'UNSEEN';
  return atMs - observedAtMs > maximumAgeMs ? 'STALE' : 'FRESH';
}

function frozenMetrics(metrics: SpotSourceMetrics): SpotSourceMetrics {
  return Object.freeze({ ...metrics });
}

function cloneTrade(value: NormalizedTrade): NormalizedTrade {
  return structuredClone(value);
}

function cloneBook(value: NormalizedBookTicker): NormalizedBookTicker {
  return structuredClone(value);
}

function cloneTicker(value: SpotRolling24hObservation): SpotRolling24hObservation {
  return {
    ...value,
    instrument: cloneInstrument(value.instrument),
  };
}

function compareDecimalIds(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function makeSourceDefinition(
  kind: SpotSourceKind,
  policy: Readonly<SpotReducerPolicy>,
): RuntimeSourceDefinition {
  const thresholds = kind === 'MINI_TICKER'
    ? { silentAfterMs: policy.sourceSilentAfterMs, staleAfterMs: policy.sourceStaleAfterMs }
    : kind === 'BOOK_TICKER'
      ? { silentAfterMs: policy.bookSourceSilentAfterMs, staleAfterMs: policy.bookSourceStaleAfterMs }
      : { silentAfterMs: policy.tradeSourceSilentAfterMs, staleAfterMs: policy.tradeSourceStaleAfterMs };
  return sourceDefinition({
    capability: kind === 'MINI_TICKER'
      ? 'spot-broad-mini-ticker'
      : kind === 'BOOK_TICKER'
        ? 'spot-book-ticker'
        : 'spot-aggregate-trade',
    streamOrPath: SPOT_SOURCE_STREAMS[kind],
    transportKind: 'WEBSOCKET',
    endpointClass: 'PUBLIC',
    productFamily: 'SPOT',
    silentAfterMs: thresholds.silentAfterMs,
    staleAfterMs: thresholds.staleAfterMs,
    maximumFutureSkewMs: policy.maximumFutureSkewMs,
    retryCeiling: 12,
    authority: 'COMPLETE',
  });
}

/** Pure, injected-clock reducer over existing authoritative Spot feed payloads. */
export class SpotBroadReducer {
  readonly #clock: RuntimeClock;
  readonly #policy: Readonly<SpotReducerPolicy>;
  readonly #symbols = new Map<string, SymbolState>();
  readonly #buffer: SpotBackpressureBuffer;
  readonly #definitions: Record<SpotSourceKind, RuntimeSourceDefinition>;
  readonly #trackers: Record<SpotSourceKind, SourceLifecycleTracker>;
  #running = false;
  #generation = 0;
  #connectedAtMs: number | null = null;
  #lastTransportReceiveTimeMs: number | null = null;
  #lastUsefulReceiveTimeMs: number | null = null;
  #lastProcessedTimeMs: number | null = null;
  #lastFramePartial = false;
  #coverageEstablishedAtMs: number | null = null;
  #coverageEstablishedGeneration: number | null = null;
  readonly #metrics: SpotSourceMetrics = {
    generation: 0,
    reconnectCount: 0,
    frameCount: 0,
    acceptedFrameCount: 0,
    partialFrameCount: 0,
    rejectedFrameCount: 0,
    tickerObservationCount: 0,
    bookObservationCount: 0,
    tradeObservationCount: 0,
    invalidCount: 0,
    unknownSymbolCount: 0,
    duplicateCount: 0,
    outOfOrderCount: 0,
    sequenceGapCount: 0,
    staleInputCount: 0,
    oldGenerationCount: 0,
    sourceGapCount: 0,
    sourceGapDurationMs: 0,
    frameOverflowDropCount: 0,
  };

  constructor(input: {
    clock: RuntimeClock;
    universe: readonly InstrumentIdentity[];
    policy?: Partial<SpotReducerPolicy>;
  }) {
    if (typeof input.clock?.nowMs !== 'function') throw new TypeError('runtime clock is required');
    this.#clock = input.clock;
    this.#policy = validatePolicy(input.policy ?? {});
    this.#definitions = {
      MINI_TICKER: makeSourceDefinition('MINI_TICKER', this.#policy),
      BOOK_TICKER: makeSourceDefinition('BOOK_TICKER', this.#policy),
      AGG_TRADE: makeSourceDefinition('AGG_TRADE', this.#policy),
    };
    this.#trackers = {
      MINI_TICKER: new SourceLifecycleTracker(this.#definitions.MINI_TICKER, this.#clock),
      BOOK_TICKER: new SourceLifecycleTracker(this.#definitions.BOOK_TICKER, this.#clock),
      AGG_TRADE: new SourceLifecycleTracker(this.#definitions.AGG_TRADE, this.#clock),
    };
    if (!Array.isArray(input.universe) || input.universe.length > this.#policy.maximumSymbols) {
      throw new TypeError('Spot universe exceeds its declared bound');
    }
    const sorted = [...input.universe].sort((left, right) => codePointCompare(left.symbol, right.symbol));
    for (const candidate of sorted) {
      const validated = validateInstrumentIdentity(candidate);
      if (!validated.ok) throw new TypeError(validated.failure.message);
      const instrument = validated.value;
      if (instrument.venue !== 'BINANCE' || instrument.productFamily !== 'SPOT' || !SYMBOL_PATTERN.test(instrument.symbol)) {
        throw new TypeError('Spot runtime universe requires canonical Binance Spot instruments');
      }
      boundedJsonByteLength(instrument, MAXIMUM_INSTRUMENT_BYTES);
      const expectedInstrumentId = stableId('instrument', {
        venue: instrument.venue,
        productFamily: instrument.productFamily,
        symbol: instrument.symbol,
        pair: instrument.pair,
        baseAsset: instrument.baseAsset,
        quoteAsset: instrument.quoteAsset,
        contractType: instrument.contractType,
        sourceMarketType: instrument.sourceMarketType,
      });
      if (instrument.instrumentId !== expectedInstrumentId) {
        throw new TypeError('Spot runtime universe instrument identity is not canonical');
      }
      if (this.#symbols.has(instrument.symbol)) throw new TypeError(`duplicate Spot universe symbol ${instrument.symbol}`);
      this.#symbols.set(instrument.symbol, {
        instrument: cloneInstrument(instrument),
        ticker24h: null,
        tickerFingerprint: null,
        bookTicker: null,
        recentTrades: [],
        lastAggregateTradeId: null,
        lastTradeSequence: null,
      });
    }
    this.#buffer = new SpotBackpressureBuffer(
      this.#policy.inboundCapacity,
      this.#policy.maximumBufferedPayloadBytes,
    );
  }

  beginGeneration(generation: number, connectedAtMs = this.#clock.nowMs()): boolean {
    safeInteger(generation, 'generation', 1);
    safeInteger(connectedAtMs, 'connectedAtMs');
    const now = safeInteger(this.#clock.nowMs(), 'clock.nowMs');
    if (connectedAtMs > now) throw new TypeError('connectedAtMs cannot be ahead of the injected clock');
    if (generation <= this.#generation) return false;
    if (generation !== this.#generation + 1) {
      throw new TypeError('generation must advance exactly once from the current generation');
    }
    if (this.#generation > 0) this.#metrics.reconnectCount += 1;
    const dropped = this.#buffer.dropGenerationsBefore(generation);
    this.#metrics.oldGenerationCount += dropped.total;
    for (const kind of SPOT_SOURCE_KINDS) {
      const tracker = this.#trackers[kind];
      const snapshot = tracker.snapshot(connectedAtMs);
      const trackerGeneration = snapshot.desiredState === 'STOPPED' ? tracker.start() : tracker.reconnect();
      if (trackerGeneration !== generation || !tracker.connected(generation, connectedAtMs)) {
        throw new TypeError(`could not align ${kind} lifecycle with generation ${generation}`);
      }
    }
    this.#trackers.MINI_TICKER.count('dropped', dropped.miniTicker);
    this.#trackers.BOOK_TICKER.count('dropped', dropped.bookTicker);
    this.#trackers.AGG_TRADE.count('dropped', dropped.aggregateTrade);
    this.#generation = generation;
    this.#metrics.generation = generation;
    this.#running = true;
    this.#connectedAtMs = connectedAtMs;
    this.#lastTransportReceiveTimeMs = null;
    this.#lastUsefulReceiveTimeMs = null;
    this.#lastProcessedTimeMs = null;
    this.#lastFramePartial = false;
    return true;
  }

  stop(): void {
    this.#running = false;
    this.#connectedAtMs = null;
    for (const kind of SPOT_SOURCE_KINDS) this.#trackers[kind].stop();
  }

  sourceDefinition(kind: SpotSourceKind): RuntimeSourceDefinition {
    return this.#definitions[kind];
  }

  enqueue(message: SpotBufferedMessage): SpotBufferOfferResult {
    const route = bufferedMessageRoute(message);
    if (!this.#acceptGeneration(route.kind, route.generation)) {
      return Object.freeze({
        state: 'DROPPED',
        reason: 'IGNORED_GENERATION',
        depth: this.#buffer.snapshot().depth,
      });
    }
    const result = this.#buffer.offer(message);
    const tracker = this.#trackers[route.kind];
    if (this.#running && result.state === 'COALESCED') tracker.count('coalesced');
    if (this.#running && result.state === 'DROPPED') {
      tracker.count('dropped');
      if (result.reason === 'OUT_OF_ORDER_REPLACEMENT') {
        tracker.count('outOfOrder');
        this.#metrics.outOfOrderCount += 1;
      }
    }
    return result;
  }

  drainBuffered(maximumItems = this.#policy.inboundCapacity): Array<SpotFrameIngestResult | SpotEvidenceIngestResult<NormalizedBookTicker | NormalizedTrade>> {
    const results: Array<SpotFrameIngestResult | SpotEvidenceIngestResult<NormalizedBookTicker | NormalizedTrade>> = [];
    for (const message of this.#buffer.drain(maximumItems)) {
      if (message.kind === 'MINI_TICKER') {
        results.push(this.ingestMiniTickerFrame({
          generation: message.generation,
          receiveTimeMs: message.receiveTimeMs,
          payload: message.payload,
          correlationId: message.correlationId,
        }));
      } else if (message.kind === 'BOOK_TICKER') {
        results.push(this.ingestBookTicker(message));
      } else {
        results.push(this.ingestAggTrade(message));
      }
    }
    return results;
  }

  ingestMiniTickerFrame(input: {
    generation: number;
    receiveTimeMs: number;
    payload: unknown;
    correlationId?: string;
  }): SpotFrameIngestResult {
    const ignoredIdentity = {
      sourceId: SOURCE_ID,
      kind: 'MINI_TICKER_FRAME',
      generation: identityToken(input.generation),
      receiveTimeMs: identityToken(input.receiveTimeMs),
      payloadInspection: 'SKIPPED_GENERATION',
    };
    if (!this.#acceptGeneration('MINI_TICKER', input.generation)) {
      const correlationId = resolveCorrelationId(input.correlationId, ignoredIdentity);
      return Object.freeze({
        state: 'IGNORED_GENERATION', correlationId, changedOnlySemantics: true, fullUniverseFrame: false,
        receivedRecords: 0, acceptedRecords: 0, invalidRecords: 0, unknownSymbols: 0,
        duplicateRecords: 0, outOfOrderRecords: 0, staleRecords: 0, droppedRecords: 0,
        observations: Object.freeze([]), events: Object.freeze([]), failures: Object.freeze([]),
      });
    }
    let admitted: AdmittedMiniTickerFrame;
    try {
      admitted = admitMiniTickerFrame(
        input.payload,
        this.#policy.maximumFrameRecords,
        this.#policy.maximumBufferedPayloadBytes,
      );
    } catch (error) {
      const receivedRecords = Array.isArray(input.payload) ? input.payload.length : 0;
      const correlationId = resolveCorrelationId(input.correlationId, {
        sourceId: SOURCE_ID,
        kind: 'MINI_TICKER_FRAME',
        generation: identityToken(input.generation),
        receiveTimeMs: identityToken(input.receiveTimeMs),
        payloadAdmission: 'REJECTED',
        receivedRecords,
        admittedPrefixLimit: this.#policy.maximumFrameRecords,
      });
      this.#metrics.frameCount += 1;
      this.#metrics.invalidCount += 1;
      this.#metrics.rejectedFrameCount += 1;
      this.#lastFramePartial = true;
      this.#trackers.MINI_TICKER.count('invalid');
      return Object.freeze({
        state: 'REJECTED', correlationId, changedOnlySemantics: true, fullUniverseFrame: false,
        receivedRecords, acceptedRecords: 0, invalidRecords: 1, unknownSymbols: 0,
        duplicateRecords: 0, outOfOrderRecords: 0, staleRecords: 0, droppedRecords: 0,
        observations: Object.freeze([]), events: Object.freeze([]),
        failures: Object.freeze([failure(
          'INVALID_VALUE',
          error instanceof Error ? error.message : String(error),
          'payload',
        )]),
      });
    }
    const correlationId = resolveCorrelationId(input.correlationId, {
      sourceId: SOURCE_ID,
      kind: 'MINI_TICKER_FRAME',
      generation: input.generation,
      receiveTimeMs: input.receiveTimeMs,
      admittedRecordCount: admitted.records.length,
      payloadPrefixDigest: admitted.prefixDigest,
      overflowIdentity: admitted.droppedRecords === 0 ? 'NONE' : 'PREFIX_TRUNCATED',
      overflowRecordCount: admitted.droppedRecords,
    });
    const empty = (state: SpotFrameIngestResult['state'], failures: StableFailure[] = []): SpotFrameIngestResult => Object.freeze({
      state,
      correlationId,
      changedOnlySemantics: true,
      fullUniverseFrame: false,
      receivedRecords: 0,
      acceptedRecords: 0,
      invalidRecords: 0,
      unknownSymbols: 0,
      duplicateRecords: 0,
      outOfOrderRecords: 0,
      staleRecords: 0,
      droppedRecords: 0,
      observations: Object.freeze([]),
      events: Object.freeze([]),
      failures: Object.freeze(failures),
    });

    this.#metrics.frameCount += 1;
    let processingTimeMs: number;
    try {
      processingTimeMs = this.#validateReceiveTime(input.receiveTimeMs);
    } catch (error) {
      this.#metrics.invalidCount += 1;
      this.#metrics.rejectedFrameCount += 1;
      this.#trackers.MINI_TICKER.count('invalid');
      return empty('REJECTED', [failure('TIMESTAMP_SKEW', error instanceof Error ? error.message : String(error), 'receiveTimeMs')]);
    }
    if (this.#lastTransportReceiveTimeMs !== null && input.receiveTimeMs < this.#lastTransportReceiveTimeMs) {
      this.#metrics.outOfOrderCount += 1;
      this.#metrics.rejectedFrameCount += 1;
      this.#trackers.MINI_TICKER.count('outOfOrder');
      return empty('REJECTED', [failure('OUT_OF_ORDER_EVENT', 'mini-ticker frame receipt precedes the accepted frame', 'receiveTimeMs')]);
    }
    this.#recordTransportReceive(input.receiveTimeMs);
    const receivedRecords = admitted.receivedRecords;
    const maximum = admitted.records.length;
    const droppedRecords = admitted.droppedRecords;
    const observations: SpotRolling24hObservation[] = [];
    const failures: StableFailure[] = [];
    let invalidRecords = 0;
    let unknownSymbols = 0;
    let duplicateRecords = 0;
    let outOfOrderRecords = 0;
    let staleRecords = 0;
    const observedSymbols = new Set<string>();

    for (let index = 0; index < maximum; index += 1) {
      let parsed: ParsedMiniTicker;
      try {
        parsed = parseMiniTicker(admitted.records[index]);
      } catch (error) {
        invalidRecords += 1;
        failures.push(failure('INVALID_VALUE', error instanceof Error ? error.message : String(error), `payload[${index}]`));
        continue;
      }
      const state = this.#symbols.get(parsed.symbol);
      if (!state) {
        unknownSymbols += 1;
        failures.push(failure('MISSING_SOURCE', 'mini-ticker symbol is absent from the supplied universe', `payload[${index}].s`));
        continue;
      }
      if (parsed.eventTimeMs > input.receiveTimeMs + this.#policy.maximumFutureSkewMs || parsed.eventTimeMs > processingTimeMs) {
        invalidRecords += 1;
        failures.push(failure('TIMESTAMP_SKEW', 'mini-ticker event time is ahead of receipt or processing', `payload[${index}].E`));
        continue;
      }
      const previous = state.ticker24h;
      if (previous && parsed.eventTimeMs < previous.sourceEventTimeMs) {
        outOfOrderRecords += 1;
        continue;
      }
      if (previous && parsed.eventTimeMs === previous.sourceEventTimeMs) {
        duplicateRecords += 1;
        if (parsed.fingerprint !== state.tickerFingerprint) invalidRecords += 1;
        continue;
      }
      const priceChange24hPercent = ((parsed.lastPrice - parsed.openPrice24h) / parsed.openPrice24h) * 100;
      if (!Number.isFinite(priceChange24hPercent)) {
        invalidRecords += 1;
        failures.push(failure('INVALID_VALUE', 'mini-ticker 24h price change is not finite', `payload[${index}]`));
        continue;
      }
      const observed: SpotRolling24hObservation = Object.freeze({
        id: stableId('runtime-spot-rolling-24h', {
          instrumentId: state.instrument.instrumentId,
          eventTimeMs: parsed.eventTimeMs,
          fingerprint: parsed.fingerprint,
        }),
        kind: 'SPOT_ROLLING_24H_TICKER',
        instrument: state.instrument,
        sourceId: SOURCE_ID,
        dataset: DATASET,
        window: 'ROLLING_24H',
        lastPrice: parsed.lastPrice,
        openPrice24h: parsed.openPrice24h,
        highPrice24h: parsed.highPrice24h,
        lowPrice24h: parsed.lowPrice24h,
        baseVolume24h: parsed.baseVolume24h,
        quoteVolume24h: parsed.quoteVolume24h,
        priceChange24hPercent,
        sourceEventTimeMs: parsed.eventTimeMs,
        sourceTransactionTimeMs: null,
        receiveTimeMs: input.receiveTimeMs,
        connectionGeneration: input.generation,
        correlationId,
      });
      state.ticker24h = observed;
      state.tickerFingerprint = parsed.fingerprint;
      observations.push(Object.freeze(cloneTicker(observed)));
      observedSymbols.add(parsed.symbol);
      if (processingTimeMs - parsed.eventTimeMs > this.#policy.tickerMaximumAgeMs) staleRecords += 1;
    }

    if (
      this.#coverageEstablishedAtMs === null
      && this.#symbols.size > 0
      && [...this.#symbols.values()].every((symbol) => (
        symbol.ticker24h !== null
        && processingTimeMs - symbol.ticker24h.sourceEventTimeMs <= this.#policy.tickerMaximumAgeMs
      ))
    ) {
      this.#coverageEstablishedAtMs = processingTimeMs;
      this.#coverageEstablishedGeneration = input.generation;
    }

    this.#metrics.invalidCount += invalidRecords;
    this.#metrics.unknownSymbolCount += unknownSymbols;
    this.#metrics.duplicateCount += duplicateRecords;
    this.#metrics.outOfOrderCount += outOfOrderRecords;
    this.#metrics.staleInputCount += staleRecords;
    this.#metrics.frameOverflowDropCount += droppedRecords;
    this.#metrics.tickerObservationCount += observations.length;
    this.#lastProcessedTimeMs = processingTimeMs;
    const freshObservations = observations.filter(
      (observation) => processingTimeMs - observation.sourceEventTimeMs <= this.#policy.tickerMaximumAgeMs,
    );
    if (freshObservations.length > 0) {
      this.#lastUsefulReceiveTimeMs = input.receiveTimeMs;
      this.#trackers.MINI_TICKER.message({
        generation: input.generation,
        sourceTimeMs: Math.max(...freshObservations.map((observation) => observation.sourceEventTimeMs)),
        receiveTimeMs: input.receiveTimeMs,
      });
      this.#trackers.MINI_TICKER.processed(input.generation, processingTimeMs);
    }
    const sourceInvalidCount = invalidRecords + unknownSymbols + staleRecords;
    if (sourceInvalidCount > 0) this.#trackers.MINI_TICKER.count('invalid', sourceInvalidCount);
    if (duplicateRecords > 0) this.#trackers.MINI_TICKER.count('duplicate', duplicateRecords);
    if (outOfOrderRecords > 0) this.#trackers.MINI_TICKER.count('outOfOrder', outOfOrderRecords);
    if (droppedRecords > 0) this.#trackers.MINI_TICKER.count('dropped', droppedRecords);

    const partial = invalidRecords + unknownSymbols + duplicateRecords + outOfOrderRecords + staleRecords + droppedRecords > 0;
    this.#lastFramePartial = partial;
    if (partial) this.#metrics.partialFrameCount += 1;
    else this.#metrics.acceptedFrameCount += 1;
    const state = observations.length === 0 && receivedRecords > 0 ? 'REJECTED' : partial ? 'PARTIAL' : 'ACCEPTED';
    if (state === 'REJECTED') this.#metrics.rejectedFrameCount += 1;
    const events: RuntimeSourceEvent<SpotRolling24hObservation>[] = observations.map((observation) => Object.freeze({
      sourceId: this.#definitions.MINI_TICKER.sourceId,
      connectionGeneration: input.generation,
      productFamily: 'SPOT',
      endpointClass: 'PUBLIC',
      stream: SPOT_SOURCE_STREAMS.MINI_TICKER,
      sourceEventTimeMs: observation.sourceEventTimeMs,
      sourceTransactionTimeMs: null,
      receiveTimeMs: input.receiveTimeMs,
      sequence: null,
      correlationId,
      payload: Object.freeze(cloneTicker(observation)),
    }));
    return Object.freeze({
      state,
      correlationId,
      changedOnlySemantics: true,
      fullUniverseFrame: observedSymbols.size === this.#symbols.size && this.#symbols.size > 0,
      receivedRecords,
      acceptedRecords: observations.length,
      invalidRecords,
      unknownSymbols,
      duplicateRecords,
      outOfOrderRecords,
      staleRecords,
      droppedRecords,
      observations: Object.freeze(observations),
      events: Object.freeze(events),
      failures: Object.freeze(failures),
    });
  }

  ingestBookTicker(input: {
    generation: number;
    receiveTimeMs: number;
    symbol: string;
    payload: unknown;
    correlationId?: string;
  }): SpotEvidenceIngestResult<NormalizedBookTicker> {
    if (!this.#acceptGeneration('BOOK_TICKER', input.generation)) {
      const correlationId = resolveCorrelationId(input.correlationId, {
        sourceId: SOURCE_ID,
        kind: 'BOOK_TICKER',
        generation: identityToken(input.generation),
        receiveTimeMs: identityToken(input.receiveTimeMs),
        symbol: symbolIdentityToken(input.symbol),
        payloadInspection: 'SKIPPED_GENERATION',
      });
      return this.#ignoredEvidence<NormalizedBookTicker>(correlationId);
    }
    const prepared = this.#prepareEvidenceIngress('BOOK_TICKER', input);
    if (!prepared.ok) return this.#rejectedEvidence<NormalizedBookTicker>(prepared.correlationId, [prepared.failure]);
    const correlationId = prepared.correlationId;
    return this.#ingestEvidence('BOOK_TICKER', input, correlationId, (state, context) => normalizeBookTicker(input.payload, context), (state, value) => {
      state.bookTicker = cloneBook(value);
      this.#metrics.bookObservationCount += 1;
    });
  }

  ingestAggTrade(input: {
    generation: number;
    receiveTimeMs: number;
    symbol: string;
    payload: unknown;
    correlationId?: string;
  }): SpotEvidenceIngestResult<NormalizedTrade> {
    if (!this.#acceptGeneration('AGG_TRADE', input.generation)) {
      const correlationId = resolveCorrelationId(input.correlationId, {
        sourceId: SOURCE_ID,
        kind: 'AGG_TRADE',
        generation: identityToken(input.generation),
        receiveTimeMs: identityToken(input.receiveTimeMs),
        symbol: symbolIdentityToken(input.symbol),
        payloadInspection: 'SKIPPED_GENERATION',
      });
      return this.#ignoredEvidence<NormalizedTrade>(correlationId);
    }
    const prepared = this.#prepareEvidenceIngress('AGG_TRADE', input);
    if (!prepared.ok) return this.#rejectedEvidence<NormalizedTrade>(prepared.correlationId, [prepared.failure]);
    const correlationId = prepared.correlationId;
    return this.#ingestEvidence('AGG_TRADE', input, correlationId, (state, context) => normalizeTrade(input.payload, context), (state, value) => {
      state.recentTrades.push(cloneTrade(value));
      if (state.recentTrades.length > this.#policy.maximumRecentTradesPerSymbol) {
        state.recentTrades.splice(0, state.recentTrades.length - this.#policy.maximumRecentTradesPerSymbol);
      }
      state.lastAggregateTradeId = value.aggregateTradeId;
      state.lastTradeSequence = value.lastTradeId;
      this.#metrics.tradeObservationCount += 1;
    }, (state, value) => {
      if (value.aggregateTradeId === null) {
        return failure('INCOMPLETE_EVIDENCE', 'Spot aggregate trade is missing its authoritative aggregate trade ID', 'payload.a');
      }
      if (state.lastAggregateTradeId === null) return null;
      const order = compareDecimalIds(value.aggregateTradeId, state.lastAggregateTradeId);
      if (order === 0) {
        return failure('DUPLICATE_EVENT', 'Spot aggregate trade ID repeats the accepted aggregate trade', 'payload.a');
      }
      if (order < 0) {
        return failure('OUT_OF_ORDER_EVENT', 'Spot aggregate trade ID precedes the accepted aggregate trade', 'payload.a');
      }
      return null;
    });
  }

  snapshot(atMs = this.#clock.nowMs()): SpotRuntimeSnapshot {
    safeInteger(atMs, 'snapshotTimeMs');
    const now = safeInteger(this.#clock.nowMs(), 'clock.nowMs');
    if (atMs > now) throw new RangeError('snapshotTimeMs cannot be ahead of the injected clock');
    const retainedKnowledgeTimeMs = Math.max(
      this.#connectedAtMs ?? 0,
      this.#lastTransportReceiveTimeMs ?? 0,
      this.#lastUsefulReceiveTimeMs ?? 0,
      this.#lastProcessedTimeMs ?? 0,
      this.#coverageEstablishedAtMs ?? 0,
    );
    if (atMs < retainedKnowledgeTimeMs) throw new RangeError('snapshotTimeMs precedes retained Spot knowledge');
    const symbols: SpotSymbolSnapshot[] = [...this.#symbols.values()].map((state) => {
      const ticker = state.ticker24h;
      const book = state.bookTicker;
      const lastTrade = state.recentTrades[state.recentTrades.length - 1] ?? null;
      return Object.freeze({
        instrument: cloneInstrument(state.instrument),
        ticker24h: ticker ? Object.freeze(cloneTicker(ticker)) : null,
        tickerFreshness: freshness(ticker?.sourceEventTimeMs ?? null, this.#policy.tickerMaximumAgeMs, atMs),
        bookTicker: book ? Object.freeze(cloneBook(book)) : null,
        bookFreshness: freshness(book?.truth.temporal.receivedTimeMs ?? null, this.#policy.bookMaximumAgeMs, atMs),
        recentTrades: Object.freeze(state.recentTrades.map((trade) => Object.freeze(cloneTrade(trade)))),
        tradeFreshness: freshness(lastTrade?.truth.temporal.sourceTransactionTimeMs ?? null, this.#policy.tradeMaximumAgeMs, atMs),
      });
    });
    const observedSymbols = symbols.reduce((count, symbol) => count + (symbol.ticker24h === null ? 0 : 1), 0);
    const freshSymbols = symbols.reduce((count, symbol) => count + (symbol.tickerFreshness === 'FRESH' ? 1 : 0), 0);
    const staleSymbols = symbols.reduce((count, symbol) => count + (symbol.tickerFreshness === 'STALE' ? 1 : 0), 0);
    const unseenSymbols = this.#symbols.size - observedSymbols;
    const coverageState: SpotUniverseCoverageSnapshot['state'] = observedSymbols === 0
      ? 'COLD'
      : unseenSymbols > 0
        ? 'WARMING'
        : staleSymbols > 0
          ? 'STALE'
          : 'COMPLETE';
    const coverage: SpotUniverseCoverageSnapshot = Object.freeze({
      state: coverageState,
      configuredSymbols: this.#symbols.size,
      observedSymbols,
      freshSymbols,
      staleSymbols,
      unseenSymbols,
      established: this.#coverageEstablishedAtMs !== null,
      establishedAtMs: this.#coverageEstablishedAtMs,
      establishedGeneration: this.#coverageEstablishedGeneration,
    });
    const trackedSources = SPOT_SOURCE_KINDS.map((kind) => this.#trackers[kind].snapshot(atMs));
    const trackedMiniTickerSource = trackedSources[0];
    if (!trackedMiniTickerSource) throw new TypeError('mini-ticker source snapshot is unavailable');
    const miniTickerSource = Object.freeze({
      ...trackedMiniTickerSource,
      completeness: trackedMiniTickerSource.completeness === 'MISSING'
        ? 'MISSING' as const
        : coverageState === 'COMPLETE'
          ? trackedMiniTickerSource.completeness
          : 'PARTIAL' as const,
    });
    const sourceSnapshots = Object.freeze([
      miniTickerSource,
      ...trackedSources.slice(1),
    ]);
    const messageAgeMs = this.#lastUsefulReceiveTimeMs === null ? null : Math.max(0, atMs - this.#lastUsefulReceiveTimeMs);
    const processingLagMs = this.#lastTransportReceiveTimeMs === null || this.#lastProcessedTimeMs === null
      ? null
      : Math.max(0, this.#lastProcessedTimeMs - this.#lastTransportReceiveTimeMs);
    return Object.freeze({
      sourceId: SOURCE_ID,
      observedState: miniTickerSource.observedState,
      connectionGeneration: this.#generation,
      connectedAtMs: this.#connectedAtMs,
      lastTransportReceiveTimeMs: this.#lastTransportReceiveTimeMs,
      lastUsefulReceiveTimeMs: this.#lastUsefulReceiveTimeMs,
      lastProcessedTimeMs: this.#lastProcessedTimeMs,
      messageAgeMs,
      processingLagMs,
      changedOnlySemantics: true,
      quietSymbolsRetained: true,
      tickerVolumeWindow: 'ROLLING_24H',
      coverage,
      sources: sourceSnapshots,
      symbols: Object.freeze(symbols),
      metrics: frozenMetrics(this.#metrics),
      backpressure: this.#buffer.snapshot(),
      snapshotTimeMs: atMs,
    });
  }

  #acceptGeneration(kind: SpotSourceKind, generation: number): boolean {
    if (!Number.isSafeInteger(generation) || generation !== this.#generation || !this.#running) {
      this.#metrics.oldGenerationCount += 1;
      if (this.#running) this.#trackers[kind].count('dropped');
      return false;
    }
    return true;
  }

  #validateReceiveTime(receiveTimeMs: number): number {
    safeInteger(receiveTimeMs, 'receiveTimeMs');
    const processingTimeMs = safeInteger(this.#clock.nowMs(), 'clock.nowMs');
    if (receiveTimeMs > processingTimeMs + this.#policy.maximumFutureSkewMs || processingTimeMs < receiveTimeMs) {
      throw new TypeError('receiveTimeMs is ahead of processing time');
    }
    return processingTimeMs;
  }

  #recordTransportReceive(receiveTimeMs: number): void {
    if (
      this.#lastTransportReceiveTimeMs !== null &&
      receiveTimeMs - this.#lastTransportReceiveTimeMs > this.#policy.sourceGapAfterMs
    ) {
      this.#metrics.sourceGapCount += 1;
      this.#metrics.sourceGapDurationMs += receiveTimeMs - this.#lastTransportReceiveTimeMs;
    }
    if (this.#lastTransportReceiveTimeMs === null || receiveTimeMs > this.#lastTransportReceiveTimeMs) {
      this.#lastTransportReceiveTimeMs = receiveTimeMs;
    }
  }

  #normalizationContext(
    kind: 'BOOK_TICKER' | 'AGG_TRADE',
    state: SymbolState,
    receiveTimeMs: number,
    processingTimeMs: number,
  ): NormalizationContext {
    const previousSequence = kind === 'BOOK_TICKER'
      ? state.bookTicker?.updateId
        ? { last: state.bookTicker.updateId, recentSourceRecordIds: state.bookTicker.truth.provenance.sourceRecordIds }
        : null
      : state.lastTradeSequence
        ? {
            last: state.lastTradeSequence,
            recentSourceRecordIds: state.recentTrades[state.recentTrades.length - 1]?.truth.provenance.sourceRecordIds ?? [],
          }
        : null;
    return {
      sourceKey: kind === 'BOOK_TICKER' ? 'SPOT_BOOK_TICKER' : 'SPOT_AGG_TRADE',
      sourceId: SOURCE_ID,
      endpointClass: 'PUBLIC',
      instrument: {
        venue: 'BINANCE',
        productFamily: 'SPOT',
        symbol: state.instrument.symbol,
        pair: state.instrument.pair,
        baseAsset: state.instrument.baseAsset,
        quoteAsset: state.instrument.quoteAsset,
        contractType: null,
      },
      receivedTimeMs: receiveTimeMs,
      evaluatedAtMs: processingTimeMs,
      maxAgeMs: kind === 'BOOK_TICKER' ? this.#policy.bookMaximumAgeMs : this.#policy.tradeMaximumAgeMs,
      maximumFutureSkewMs: this.#policy.maximumFutureSkewMs,
      previousSequence,
      producerVersion: 'spot-runtime-adapter-1',
      configurationVersion: this.#policy.configurationVersion,
    };
  }

  #prepareEvidenceIngress(
    kind: 'BOOK_TICKER' | 'AGG_TRADE',
    input: { generation: number; receiveTimeMs: number; symbol: string; payload: unknown; correlationId?: string },
  ): { ok: true; correlationId: string } | { ok: false; correlationId: string; failure: StableFailure } {
    const reject = (message: string, field: 'symbol' | 'payload') => {
      const correlationId = resolveCorrelationId(input.correlationId, {
        sourceId: SOURCE_ID,
        kind,
        generation: identityToken(input.generation),
        receiveTimeMs: identityToken(input.receiveTimeMs),
        symbol: symbolIdentityToken(input.symbol),
        payloadAdmission: field === 'payload' ? 'REJECTED' : 'NOT_INSPECTED',
      });
      this.#metrics.invalidCount += 1;
      this.#trackers[kind].count('invalid');
      return { ok: false as const, correlationId, failure: failure('INVALID_VALUE', message, field) };
    };
    if (typeof input.symbol !== 'string' || !SYMBOL_PATTERN.test(input.symbol)) {
      return reject('Spot source symbol must be a bounded canonical market token', 'symbol');
    }
    try {
      boundedJsonByteLength(input.payload, this.#policy.maximumBufferedPayloadBytes);
    } catch (error) {
      return reject(
        error instanceof RangeError
          ? 'Spot source payload exceeds maximumBufferedPayloadBytes or structural bounds'
          : 'Spot source payload must be bounded plain data',
        'payload',
      );
    }
    return {
      ok: true,
      correlationId: resolveCorrelationId(input.correlationId, {
        sourceId: SOURCE_ID,
        kind,
        generation: input.generation,
        receiveTimeMs: input.receiveTimeMs,
        symbol: input.symbol,
        sourceEvent: sourceEventIdentity(input.payload),
        payloadDigest: payloadDigest(input.payload),
      }),
    };
  }

  #ingestEvidence<T extends NormalizedBookTicker | NormalizedTrade>(
    kind: 'BOOK_TICKER' | 'AGG_TRADE',
    input: { generation: number; receiveTimeMs: number; symbol: string; payload: unknown; correlationId?: string },
    correlationId: string,
    normalize: (state: SymbolState, context: NormalizationContext) =>
      | { ok: true; value: T; qualityFailures: StableFailure[] }
      | { ok: false; failures: StableFailure[] },
    accept: (state: SymbolState, value: T) => void,
    validate?: (state: SymbolState, value: T) => StableFailure | null,
  ): SpotEvidenceIngestResult<T> {
    const tracker = this.#trackers[kind];
    let processingTimeMs: number;
    try {
      processingTimeMs = this.#validateReceiveTime(input.receiveTimeMs);
    } catch (error) {
      this.#metrics.invalidCount += 1;
      tracker.count('invalid');
      return this.#rejectedEvidence<T>(correlationId, [failure('TIMESTAMP_SKEW', error instanceof Error ? error.message : String(error), 'receiveTimeMs')]);
    }
    const priorReceiveTimeMs = tracker.snapshot(processingTimeMs).lastMessageReceiveTimeMs;
    if (priorReceiveTimeMs !== null && input.receiveTimeMs < priorReceiveTimeMs) {
      this.#metrics.outOfOrderCount += 1;
      tracker.count('outOfOrder');
      return this.#rejectedEvidence<T>(correlationId, [
        failure('OUT_OF_ORDER_EVENT', `${kind} receipt precedes the accepted source message`, 'receiveTimeMs'),
      ]);
    }
    const state = this.#symbols.get(input.symbol);
    if (!state) {
      this.#metrics.unknownSymbolCount += 1;
      tracker.count('invalid');
      return this.#rejectedEvidence<T>(correlationId, [failure('MISSING_SOURCE', 'Spot symbol is absent from the supplied universe', 'symbol')]);
    }
    const context = this.#normalizationContext(kind, state, input.receiveTimeMs, processingTimeMs);
    const result = normalize(state, context);
    if (!result.ok) {
      const codes = new Set(result.failures.map((entry) => entry.code));
      if (codes.has('DUPLICATE_EVENT')) {
        this.#metrics.duplicateCount += 1;
        tracker.count('duplicate');
      } else if (codes.has('OUT_OF_ORDER_EVENT')) {
        this.#metrics.outOfOrderCount += 1;
        tracker.count('outOfOrder');
      } else {
        this.#metrics.invalidCount += 1;
        tracker.count('invalid');
      }
      return this.#rejectedEvidence<T>(correlationId, result.failures);
    }
    const validationFailure = validate?.(state, result.value) ?? null;
    if (validationFailure !== null) {
      if (validationFailure.code === 'DUPLICATE_EVENT') {
        this.#metrics.duplicateCount += 1;
        tracker.count('duplicate');
      } else if (validationFailure.code === 'OUT_OF_ORDER_EVENT') {
        this.#metrics.outOfOrderCount += 1;
        tracker.count('outOfOrder');
      } else {
        this.#metrics.invalidCount += 1;
        tracker.count('invalid');
      }
      return this.#rejectedEvidence<T>(correlationId, [validationFailure]);
    }
    const sequenceGap = result.qualityFailures.some((entry) => entry.code === 'SEQUENCE_GAP');
    if (sequenceGap) this.#metrics.sequenceGapCount += 1;
    const stale = result.value.truth.freshness.state === 'STALE';
    if (stale) this.#metrics.staleInputCount += 1;
    accept(state, result.value);
    if (stale) {
      tracker.count('invalid');
    } else {
      tracker.message({
        generation: input.generation,
        sourceTimeMs: kind === 'BOOK_TICKER'
          ? null
          : result.value.truth.temporal.sourceTransactionTimeMs ?? result.value.truth.temporal.sourceEventTimeMs,
        receiveTimeMs: input.receiveTimeMs,
      });
      tracker.processed(input.generation, processingTimeMs);
    }
    if (sequenceGap) tracker.count('sequenceGap');
    return Object.freeze({
      state: 'ACCEPTED',
      correlationId,
      evidence: result.value,
      qualityFailures: Object.freeze([...result.qualityFailures]),
      failures: Object.freeze([]),
    });
  }

  #ignoredEvidence<T extends NormalizedBookTicker | NormalizedTrade>(correlationId: string): SpotEvidenceIngestResult<T> {
    return Object.freeze({
      state: 'IGNORED_GENERATION',
      correlationId,
      evidence: null,
      qualityFailures: Object.freeze([]),
      failures: Object.freeze([]),
    });
  }

  #rejectedEvidence<T extends NormalizedBookTicker | NormalizedTrade>(
    correlationId: string,
    failures: StableFailure[],
  ): SpotEvidenceIngestResult<T> {
    return Object.freeze({
      state: 'REJECTED',
      correlationId,
      evidence: null,
      qualityFailures: Object.freeze([]),
      failures: Object.freeze([...failures]),
    });
  }

}
