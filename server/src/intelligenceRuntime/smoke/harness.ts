import {
  stableId,
  type InstrumentIdentity,
  type NormalizedEvidence,
} from '../../intelligenceFoundation/contracts/index.js';
import {
  type PublicRestRequest,
  type PublicRestResponse,
  type PublicWebSocketConnection,
  type PublicWebSocketEvent,
} from '../contracts/index.js';
import { FuturesRuntimeAdapter } from '../futures/index.js';
import { buildRuntimeIntelligenceSnapshot } from '../snapshot/index.js';
import { SpotBroadReducer } from '../spot/index.js';
import {
  BinancePublicUniverseAdapter,
  type RuntimeUniverseSnapshot,
} from '../universe/index.js';
import {
  createPublicSmokeConfig,
  publicSmokeWebSocketDescriptors,
  validateSmokeSymbol,
} from './config.js';
import type {
  PublicNoKeySmokeOptions,
  PublicNoKeySmokeResult,
  PublicSmokeConfig,
  PublicSmokeOutcome,
  PublicSmokeRunInput,
  PublicSmokeShutdownSummary,
  PublicSmokeSourceKey,
  PublicSmokeSourceSnapshot,
  PublicSmokeSourceState,
  PublicSmokeStep,
  PublicSmokeStepState,
  PublicSmokeUniverseSummary,
  PublicSmokeWebSocketDescriptor,
} from './types.js';

interface InternalSource {
  readonly descriptor: PublicSmokeWebSocketDescriptor;
  state: PublicSmokeSourceState;
  openedAtMs: number | null;
  lastReceiveTimeMs: number | null;
  receivedMessageCount: number;
  acceptedMessageCount: number;
  droppedMessageCount: number;
  normalizedEvidenceCount: number;
  closedAtMs: number | null;
  closeObserved: boolean;
  closeRequested: boolean;
  endedBeforeShutdown: boolean;
  terminalFailure: boolean;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  connection: PublicWebSocketConnection | null;
}

interface RestObservation {
  readonly source: 'SPOT' | 'USD_M_PERPETUAL';
  readonly status: number | null;
  readonly error: string | null;
}

interface FocusCounters {
  aggregateTrade: number;
  bookTicker: number;
  depth: number;
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function safeInteger(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function safeAdd(left: number, right: number, name: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} overflow`);
  return value;
}

function boundedError(value: unknown, maximum: number, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, maximum);
}

function blockedText(value: string | null): boolean {
  return value !== null && /(?:\b451\b|geo(?:location)?|restricted location|not available in your region)/i.test(value);
}

function restSource(request: PublicRestRequest): RestObservation['source'] {
  return request.path === '/api/v3/exchangeInfo' ? 'SPOT' : 'USD_M_PERPETUAL';
}

function sourceSnapshot(
  source: InternalSource,
  atMs: number,
  maximumAcceptedMessageAgeMs: number,
): PublicSmokeSourceSnapshot {
  const messageAgeMs = source.lastReceiveTimeMs === null ? null : Math.max(0, atMs - source.lastReceiveTimeMs);
  return Object.freeze({
    key: source.descriptor.key,
    sourceId: source.descriptor.sourceId,
    endpointClass: source.descriptor.endpointClass,
    productFamily: source.descriptor.productFamily,
    url: source.descriptor.url,
    state: source.state,
    required: source.descriptor.required,
    openedAtMs: source.openedAtMs,
    lastReceiveTimeMs: source.lastReceiveTimeMs,
    messageAgeMs,
    acceptedMessageCount: source.acceptedMessageCount,
    droppedMessageCount: source.droppedMessageCount,
    normalizedEvidenceCount: source.normalizedEvidenceCount,
    closedAtMs: source.closedAtMs,
    closeObserved: source.closeObserved,
    endedBeforeShutdown: source.endedBeforeShutdown,
    fresh: messageAgeMs !== null
      && messageAgeMs <= maximumAcceptedMessageAgeMs
      && !source.endedBeforeShutdown
      && !source.terminalFailure,
    receivedMessageCount: source.receivedMessageCount,
    lastErrorCode: source.lastErrorCode,
    lastErrorMessage: source.lastErrorMessage,
  });
}

function universeSummary(
  snapshot: RuntimeUniverseSnapshot,
  focusSymbol: string,
  observations: readonly RestObservation[],
): PublicSmokeUniverseSummary {
  const spotState = snapshot.sources.SPOT.state;
  const usdMState = snapshot.sources.USD_M_PERPETUAL.state;
  const state = spotState === 'COMPLETE' && usdMState === 'COMPLETE'
    ? 'COMPLETE'
    : snapshot.graph.nodes.length > 0
      ? 'PARTIAL'
      : 'UNAVAILABLE';
  return Object.freeze({
    state,
    nodeCount: snapshot.graph.nodes.length,
    spotState,
    usdMState,
    focusSymbolPresent: snapshot.graph.nodes.some((node) => node.spot?.instrument.symbol === focusSymbol),
    blocked: observations.some((entry) => entry.status === 451 || blockedText(entry.error)),
  });
}

function activeSpotInstruments(
  universe: RuntimeUniverseSnapshot,
  focusSymbol: string,
  maximum: number,
): InstrumentIdentity[] {
  const values = universe.graph.nodes
    .map((node) => node.spot)
    .filter((listing): listing is NonNullable<typeof listing> => listing !== null)
    .filter((listing) => listing.marketAvailability === 'ACTIVE')
    .map((listing) => listing.instrument)
    .sort((left, right) => (
      Number(right.symbol === focusSymbol) - Number(left.symbol === focusSymbol)
      || codePointCompare(left.symbol, right.symbol)
      || codePointCompare(left.instrumentId, right.instrumentId)
    ))
    .slice(0, maximum);
  return values.map((instrument) => structuredClone(instrument));
}

function futuresSeedMap(universe: RuntimeUniverseSnapshot, maximum: number) {
  const map = new Map<string, {
    venue: 'BINANCE';
    productFamily: 'USD_M_PERPETUAL';
    symbol: string;
    pair: string;
    baseAsset: string;
    quoteAsset: string;
    contractType: 'PERPETUAL' | null;
  }>();
  const listings = universe.graph.nodes
    .map((node) => node.usdMPerpetual)
    .filter((listing): listing is NonNullable<typeof listing> => listing !== null)
    .filter((listing) => listing.marketAvailability === 'ACTIVE')
    .sort((left, right) => codePointCompare(left.instrument.symbol, right.instrument.symbol))
    .slice(0, maximum);
  for (const listing of listings) {
    const instrument = listing.instrument;
    if (instrument.pair === null || instrument.quoteAsset === null) continue;
    map.set(`${instrument.symbol}\u0000${instrument.pair}`, {
      venue: 'BINANCE',
      productFamily: 'USD_M_PERPETUAL',
      symbol: instrument.symbol,
      pair: instrument.pair,
      baseAsset: instrument.baseAsset,
      quoteAsset: instrument.quoteAsset,
      contractType: instrument.contractType === 'PERPETUAL' ? 'PERPETUAL' : null,
    });
  }
  return map;
}

function sourceByKey(sources: readonly InternalSource[], key: PublicSmokeSourceKey): InternalSource {
  const source = sources.find((entry) => entry.descriptor.key === key);
  if (!source) throw new Error(`smoke source ${key} is missing`);
  return source;
}

function unwrapCombined(data: unknown): { stream: string | null; payload: unknown } {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if (typeof record.stream === 'string' && 'data' in record) return { stream: record.stream, payload: record.data };
  }
  return { stream: null, payload: data };
}

const SMOKE_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAXIMUM_SMOKE_DEPTH_LEVELS = 5_000;

function depthDecimal(value: unknown, field: string, allowZero: boolean): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || !SMOKE_DECIMAL_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a bounded unsigned decimal string`);
  }
  if (!allowZero && /^0+(?:\.0+)?$/.test(value)) throw new TypeError(`${field} must be greater than zero`);
}

function validateDepthLevels(value: unknown, field: string): number {
  if (!Array.isArray(value) || value.length > MAXIMUM_SMOKE_DEPTH_LEVELS) {
    throw new TypeError(`${field} must be a bounded Spot depth level array`);
  }
  for (const level of value) {
    if (!Array.isArray(level) || level.length !== 2) throw new TypeError(`${field} contains an invalid depth level`);
    depthDecimal(level[0], `${field}.price`, false);
    depthDecimal(level[1], `${field}.quantity`, true);
  }
  return value.length;
}

function validateFocusedSpotDepth(input: {
  payload: unknown;
  symbol: string;
  receiveTimeMs: number;
  maximumAgeMs: number;
  previousUpdateId: number | null;
}): number {
  if (input.payload === null || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new TypeError('focused Spot depth payload must be an object');
  }
  const record = input.payload as Record<string, unknown>;
  if (record.e !== 'depthUpdate' || record.s !== input.symbol) {
    throw new TypeError('focused Spot depth event type or symbol is invalid');
  }
  const eventTimeMs = safeInteger(record.E, 'focused depth event time');
  if (eventTimeMs > input.receiveTimeMs || input.receiveTimeMs - eventTimeMs > input.maximumAgeMs) {
    throw new TypeError('focused Spot depth event time is not fresh at receipt');
  }
  const firstUpdateId = safeInteger(record.U, 'focused depth first update id');
  const finalUpdateId = safeInteger(record.u, 'focused depth final update id');
  if (firstUpdateId > finalUpdateId) throw new TypeError('focused Spot depth update range is inverted');
  const levelCount = validateDepthLevels(record.b, 'focused depth bids')
    + validateDepthLevels(record.a, 'focused depth asks');
  if (levelCount === 0) throw new TypeError('focused Spot depth update contains no changed level');
  if (input.previousUpdateId !== null) {
    const next = input.previousUpdateId + 1;
    if (!Number.isSafeInteger(next) || firstUpdateId > next || finalUpdateId < next) {
      throw new TypeError('focused Spot depth update has a sequence gap, duplicate, or regression');
    }
  }
  return finalUpdateId;
}

export class PublicNoKeySmokeHarness {
  readonly #options: PublicNoKeySmokeOptions;
  readonly #config: Readonly<PublicSmokeConfig>;
  #runPromise: Promise<PublicNoKeySmokeResult> | null = null;
  #completed = false;

  constructor(options: PublicNoKeySmokeOptions) {
    if (typeof options?.clock?.nowMs !== 'function') throw new TypeError('smoke clock is required');
    if (typeof options?.wait?.wait !== 'function') throw new TypeError('smoke wait port is required');
    if (typeof options?.reporter?.report !== 'function') throw new TypeError('smoke reporter is required');
    if (typeof options?.restTransport?.request !== 'function') throw new TypeError('public REST transport is required');
    if (typeof options?.webSocketTransport?.connect !== 'function') throw new TypeError('public WebSocket transport is required');
    this.#options = options;
    this.#config = createPublicSmokeConfig(options.config);
  }

  run(input: PublicSmokeRunInput = {}): Promise<PublicNoKeySmokeResult> {
    if (this.#runPromise !== null) return this.#runPromise;
    if (this.#completed) return Promise.reject(new Error('manual public smoke harness is single-use'));
    const promise = this.#run(input).finally(() => {
      this.#completed = true;
      if (this.#runPromise === promise) this.#runPromise = null;
    });
    this.#runPromise = promise;
    return promise;
  }

  async #run(input: PublicSmokeRunInput): Promise<PublicNoKeySmokeResult> {
    const startedAtMs = this.#now();
    const durationMs = safeInteger(input.durationMs ?? this.#config.defaultDurationMs, 'smoke duration', 100);
    if (durationMs > this.#config.maximumDurationMs) throw new RangeError('smoke duration exceeds its configured bound');
    const focusSymbol = validateSmokeSymbol(input.focusSymbol ?? 'BTCUSDT');
    const steps: PublicSmokeStep[] = [];
    const restObservations: RestObservation[] = [];
    const normalizedIds: string[] = [];
    const normalizedIdSet = new Set<string>();
    let normalizedEvidenceCount = 0;
    let truncatedNormalizedEvidenceIds = 0;
    let fatalError: string | null = null;
    const focusCounters: FocusCounters = { aggregateTrade: 0, bookTicker: 0, depth: 0 };

    const report = (step: string, state: PublicSmokeStepState, detail: string): void => {
      if (steps.length >= this.#config.maximumSteps) return;
      const entry = Object.freeze({
        step,
        state,
        detail: boundedError(detail, this.#config.maximumErrorLength, 'no detail'),
        observedAtMs: this.#now(),
      });
      steps.push(entry);
      try { this.#options.reporter.report(entry); } catch { /* reporting cannot change observed source truth */ }
    };

    const observingRest = {
      request: async <T = unknown>(request: PublicRestRequest): Promise<PublicRestResponse<T>> => {
        const source = restSource(request);
        try {
          const response = await this.#options.restTransport.request<T>(request);
          restObservations.push(Object.freeze({ source, status: response.status, error: null }));
          return response;
        } catch (error) {
          restObservations.push(Object.freeze({
            source,
            status: null,
            error: boundedError(error instanceof Error ? error.message : error, this.#config.maximumErrorLength, 'public REST request failed'),
          }));
          throw error;
        }
      },
    };

    const universeAdapter = new BinancePublicUniverseAdapter({
      transport: observingRest,
      clock: this.#options.clock,
      config: {
        requestTimeoutMs: this.#config.requestTimeoutMs,
        maximumResponseBytes: this.#config.maximumRestResponseBytes,
        maximumSymbolsPerSource: this.#config.maximumUniverseInstruments,
        universePolicy: { maxRecordsPerSource: this.#config.maximumUniverseInstruments },
      },
    });
    let universe: RuntimeUniverseSnapshot;
    try {
      universe = await universeAdapter.tick();
    } catch (error) {
      fatalError = boundedError(error instanceof Error ? error.message : error, this.#config.maximumErrorLength, 'universe adapter failed');
      throw new Error(`public smoke universe adapter failed: ${fatalError}`);
    }
    const universeView = universeSummary(universe, focusSymbol, restObservations);
    for (const source of ['SPOT', 'USD_M_PERPETUAL'] as const) {
      const observed = restObservations.find((entry) => entry.source === source);
      const state: PublicSmokeStepState = observed?.status === 200
        ? 'PASS'
        : observed?.status === 451 || blockedText(observed?.error ?? null)
          ? 'BLOCKED'
          : 'UNAVAILABLE';
      report(
        source === 'SPOT' ? 'spot_exchange_info' : 'usd_m_exchange_info',
        state,
        observed?.status === 200
          ? `${source} public exchangeInfo loaded without credentials`
          : `public exchangeInfo unavailable${observed?.status === null || observed?.status === undefined ? '' : ` with HTTP ${observed.status}`}`,
      );
    }
    report(
      'universe_join',
      universeView.nodeCount > 0 ? 'PASS' : universeView.blocked ? 'BLOCKED' : 'UNAVAILABLE',
      universeView.nodeCount > 0
        ? `joined ${universeView.nodeCount} authoritative public market nodes`
        : 'no authoritative universe node could be joined',
    );

    const spotInstruments = activeSpotInstruments(
      universe,
      focusSymbol,
      this.#config.maximumUniverseInstruments,
    );
    const focusPresent = spotInstruments.some((instrument) => instrument.symbol === focusSymbol);
    const spot = new SpotBroadReducer({
      clock: this.#options.clock,
      universe: spotInstruments,
      policy: {
        maximumSymbols: this.#config.maximumUniverseInstruments,
        maximumFrameRecords: this.#config.maximumUniverseInstruments,
        inboundCapacity: Math.min(4_096, this.#config.maximumMessagesPerSource),
        maximumRecentTradesPerSymbol: Math.min(256, this.#config.maximumMessagesPerSource),
        maximumBufferedPayloadBytes: this.#config.maximumWebSocketMessageBytes,
      },
    });
    const futuresSeeds = futuresSeedMap(universe, this.#config.maximumUniverseInstruments);
    const futures = new FuturesRuntimeAdapter(this.#options.clock, {
      maximumSymbols: this.#config.maximumUniverseInstruments,
      maximumRecordsPerMessage: this.#config.maximumUniverseInstruments,
      instrumentResolver: {
        resolve(identity) {
          return futuresSeeds.get(`${identity.symbol}\u0000${identity.pair}`) ?? null;
        },
      },
    });
    const futuresBookGeneration = futures.start('BOOK_TICKER');
    const futuresMarkGeneration = futures.start('MARK_FUNDING');
    let spotGenerationStarted = false;

    const descriptors = publicSmokeWebSocketDescriptors(focusSymbol);
    const sources: InternalSource[] = descriptors.map((descriptor) => ({
      descriptor,
      state: descriptor.key === 'SPOT_FOCUS' && !focusPresent ? 'UNAVAILABLE' : 'PENDING',
      openedAtMs: null,
      lastReceiveTimeMs: null,
      receivedMessageCount: 0,
      acceptedMessageCount: 0,
      droppedMessageCount: 0,
      normalizedEvidenceCount: 0,
      closedAtMs: null,
      closeObserved: false,
      closeRequested: false,
      endedBeforeShutdown: false,
      terminalFailure: descriptor.key === 'SPOT_FOCUS' && !focusPresent,
      lastErrorCode: descriptor.key === 'SPOT_FOCUS' && !focusPresent ? 'FOCUS_SYMBOL_NOT_IN_UNIVERSE' : null,
      lastErrorMessage: descriptor.key === 'SPOT_FOCUS' && !focusPresent
        ? 'temporary focus was not opened because the Spot listing is absent from the authoritative universe'
        : null,
      connection: null,
    }));

    const recordEvidence = (source: InternalSource, evidence: NormalizedEvidence | null): void => {
      if (evidence === null) return;
      source.normalizedEvidenceCount = safeAdd(source.normalizedEvidenceCount, 1, 'source normalized evidence count');
      normalizedEvidenceCount = safeAdd(normalizedEvidenceCount, 1, 'normalized evidence count');
      if (normalizedIdSet.has(evidence.id)) return;
      normalizedIdSet.add(evidence.id);
      if (normalizedIds.length < this.#config.maximumNormalizedEvidenceIds) normalizedIds.push(evidence.id);
      else truncatedNormalizedEvidenceIds = safeAdd(truncatedNormalizedEvidenceIds, 1, 'truncated normalized evidence ids');
    };

    let closeRequests = 0;
    let shutdownStarted = false;
    let lastFocusDepthUpdateId: number | null = null;

    const requestSourceClose = (source: InternalSource, reason: string): void => {
      if (source.connection === null || source.closeRequested) return;
      source.closeRequested = true;
      closeRequests = safeAdd(closeRequests, 1, 'close request count');
      try { source.connection.close(1000, reason); } catch {
        source.terminalFailure = true;
        source.lastErrorCode = 'CLOSE_FAILED';
        source.lastErrorMessage = 'public WebSocket connection rejected a close request';
        source.state = 'FAILED';
      }
    };

    const markSourceFailure = (source: InternalSource, code: string, message: string): void => {
      source.lastErrorCode = boundedError(code, this.#config.maximumErrorLength, 'SOURCE_ERROR');
      source.lastErrorMessage = boundedError(message, this.#config.maximumErrorLength, 'public source unavailable');
      source.terminalFailure = true;
      source.state = blockedText(`${code} ${message}`) ? 'BLOCKED' : 'UNAVAILABLE';
    };

    const handleMessage = (source: InternalSource, data: unknown, receiveTimeMs: number): void => {
      if (source.receivedMessageCount >= this.#config.maximumMessagesPerSource) {
        source.droppedMessageCount = safeAdd(source.droppedMessageCount, 1, 'dropped message count');
        requestSourceClose(source, 'bounded smoke message cap reached');
        return;
      }
      source.receivedMessageCount = safeAdd(source.receivedMessageCount, 1, 'received message count');
      if (source.terminalFailure || source.endedBeforeShutdown) {
        source.droppedMessageCount = safeAdd(source.droppedMessageCount, 1, 'dropped message count');
        return;
      }
      let accepted = false;
      try {
        if (source.descriptor.key === 'SPOT_BROAD') {
          const result = spot.ingestMiniTickerFrame({ generation: 1, receiveTimeMs, payload: unwrapCombined(data).payload });
          if (result.acceptedRecords === 0) throw new TypeError('broad Spot frame contained no semantically accepted record');
          accepted = true;
        } else if (source.descriptor.key === 'USD_M_BOOK') {
          const result = futures.ingest('BOOK_TICKER', futuresBookGeneration, unwrapCombined(data).payload, receiveTimeMs);
          if (result.accepted === 0) throw new TypeError('broad USD-M book frame contained no semantically accepted record');
          for (const emission of result.normalized) if (emission.status === 'NORMALIZED') recordEvidence(source, emission.evidence);
          accepted = true;
        } else if (source.descriptor.key === 'USD_M_MARK_FUNDING') {
          const result = futures.ingest('MARK_FUNDING', futuresMarkGeneration, unwrapCombined(data).payload, receiveTimeMs);
          if (result.accepted === 0) throw new TypeError('USD-M mark/funding frame contained no semantically accepted record');
          for (const emission of result.normalized) if (emission.status === 'NORMALIZED') recordEvidence(source, emission.evidence);
          accepted = true;
        } else {
          const combined = unwrapCombined(data);
          const stream = combined.stream ?? '';
          const focusStreamPrefix = focusSymbol.toLowerCase();
          if (stream === `${focusStreamPrefix}@aggTrade`) {
            const result = spot.ingestAggTrade({
              generation: 1,
              receiveTimeMs,
              symbol: focusSymbol,
              payload: combined.payload,
            });
            if (result.state !== 'ACCEPTED' || result.evidence === null) throw new TypeError('focused aggregate trade was not normalized');
            focusCounters.aggregateTrade = safeAdd(focusCounters.aggregateTrade, 1, 'focus aggregate trade count');
            recordEvidence(source, result.evidence);
            accepted = true;
          } else if (stream === `${focusStreamPrefix}@bookTicker`) {
            const result = spot.ingestBookTicker({
              generation: 1,
              receiveTimeMs,
              symbol: focusSymbol,
              payload: combined.payload,
            });
            if (result.state !== 'ACCEPTED' || result.evidence === null) throw new TypeError('focused book ticker was not normalized');
            focusCounters.bookTicker = safeAdd(focusCounters.bookTicker, 1, 'focus book ticker count');
            recordEvidence(source, result.evidence);
            accepted = true;
          } else if (stream === `${focusStreamPrefix}@depth@100ms`) {
            lastFocusDepthUpdateId = validateFocusedSpotDepth({
              payload: combined.payload,
              symbol: focusSymbol,
              receiveTimeMs,
              maximumAgeMs: this.#config.maximumAcceptedMessageAgeMs,
              previousUpdateId: lastFocusDepthUpdateId,
            });
            focusCounters.depth = safeAdd(focusCounters.depth, 1, 'focus depth count');
            accepted = true;
          } else {
            throw new TypeError('combined focus message did not identify the exact aggTrade, bookTicker, or depth stream');
          }
        }
      } catch (error) {
        source.droppedMessageCount = safeAdd(source.droppedMessageCount, 1, 'dropped message count');
        source.lastErrorCode = 'INVALID_PUBLIC_MESSAGE';
        source.lastErrorMessage = boundedError(error instanceof Error ? error.message : error, this.#config.maximumErrorLength, 'public message rejected');
      }
      if (accepted) {
        source.acceptedMessageCount = safeAdd(source.acceptedMessageCount, 1, 'accepted message count');
        source.lastReceiveTimeMs = receiveTimeMs;
        source.state = 'LIVE';
      }
      if (source.receivedMessageCount >= this.#config.maximumMessagesPerSource) {
        requestSourceClose(source, 'bounded smoke message cap reached');
      }
    };

    const handleEvent = (source: InternalSource, event: PublicWebSocketEvent): void => {
      if (event.kind === 'OPEN') {
        if (source.terminalFailure) return;
        source.state = 'OPEN';
        source.openedAtMs = event.receiveTimeMs;
        if (source.descriptor.productFamily === 'SPOT' && !spotGenerationStarted) {
          spot.beginGeneration(1, event.receiveTimeMs);
          spotGenerationStarted = true;
        }
        if (source.descriptor.key === 'USD_M_BOOK') futures.connected('BOOK_TICKER', futuresBookGeneration, event.receiveTimeMs);
        if (source.descriptor.key === 'USD_M_MARK_FUNDING') futures.connected('MARK_FUNDING', futuresMarkGeneration, event.receiveTimeMs);
      } else if (event.kind === 'MESSAGE') {
        handleMessage(source, event.data, event.receiveTimeMs);
      } else if (event.kind === 'ERROR') {
        markSourceFailure(source, event.code, event.message);
      } else if (event.kind === 'CLOSE') {
        source.closeObserved = true;
        source.closedAtMs = event.receiveTimeMs;
        if (!shutdownStarted) {
          source.endedBeforeShutdown = true;
          source.terminalFailure = true;
          if (source.state !== 'BLOCKED' && source.state !== 'FAILED' && source.state !== 'UNAVAILABLE') {
            source.state = 'UNAVAILABLE';
            source.lastErrorCode = 'SOURCE_CLOSED_EARLY';
            source.lastErrorMessage = 'public source closed before the bounded observation window ended';
          }
        } else if (source.state !== 'BLOCKED' && source.state !== 'FAILED' && source.state !== 'UNAVAILABLE') {
          source.state = 'CLOSED';
        }
      }
    };

    for (const source of sources) {
      if (source.state === 'UNAVAILABLE') continue;
      source.state = 'CONNECTING';
      try {
        source.connection = this.#options.webSocketTransport.connect({
          sourceId: source.descriptor.sourceId,
          url: source.descriptor.url,
          generation: 1,
          maximumMessageBytes: this.#config.maximumWebSocketMessageBytes,
          onEvent: (event) => {
            try { handleEvent(source, event); } catch (error) {
              source.state = 'FAILED';
              source.terminalFailure = true;
              source.lastErrorCode = 'SMOKE_EVENT_HANDLER_FAILED';
              source.lastErrorMessage = boundedError(
                error instanceof Error ? error.message : error,
                this.#config.maximumErrorLength,
                'manual smoke event handler failed',
              );
            }
          },
        });
      } catch (error) {
        markSourceFailure(source, 'CONNECT_FAILED', error instanceof Error ? error.message : String(error));
      }
    }

    try {
      await this.#options.wait.wait(durationMs);
    } catch (error) {
      fatalError = boundedError(error instanceof Error ? error.message : error, this.#config.maximumErrorLength, 'smoke wait failed');
    }

    const observationTimeMs = this.#now();
    const spotBroad = sourceByKey(sources, 'SPOT_BROAD');
    const usdMBook = sourceByKey(sources, 'USD_M_BOOK');
    const usdMMark = sourceByKey(sources, 'USD_M_MARK_FUNDING');
    const focus = sourceByKey(sources, 'SPOT_FOCUS');
    const sourceIsHealthy = (source: InternalSource): boolean => (
      source.acceptedMessageCount > 0
      && source.lastReceiveTimeMs !== null
      && observationTimeMs - source.lastReceiveTimeMs <= this.#config.maximumAcceptedMessageAgeMs
      && !source.endedBeforeShutdown
      && !source.terminalFailure
      && source.state === 'LIVE'
    );
    const stepState = (source: InternalSource): PublicSmokeStepState => sourceIsHealthy(source)
      ? 'PASS'
      : source.state === 'BLOCKED'
        ? 'BLOCKED'
        : 'UNAVAILABLE';
    const requiredSourcesHealthy = [spotBroad, usdMBook, usdMMark].every(sourceIsHealthy);
    report('broad_spot_messages', stepState(spotBroad), `${spotBroad.acceptedMessageCount}/${spotBroad.receivedMessageCount} broad Spot messages were semantically accepted`);
    report('broad_usd_m_messages', stepState(usdMBook), `${usdMBook.acceptedMessageCount}/${usdMBook.receivedMessageCount} broad USD-M book messages were semantically accepted`);
    report('mark_funding_messages', stepState(usdMMark), `${usdMMark.acceptedMessageCount}/${usdMMark.receivedMessageCount} USD-M mark/funding messages were semantically accepted`);
    const aged = sources.some((source) => source.lastReceiveTimeMs !== null && observationTimeMs > source.lastReceiveTimeMs);
    report('message_age', aged ? 'PASS' : sources.some((source) => source.lastReceiveTimeMs !== null) ? 'UNAVAILABLE' : 'UNAVAILABLE', aged ? 'at least one message age advanced against the injected clock' : 'no positive message-age advance was observable');
    report('temporary_focus', focusPresent ? 'PASS' : universeView.blocked ? 'BLOCKED' : 'UNAVAILABLE', focusPresent ? `${focusSymbol} was selected directly from public universe truth without a proposal` : `${focusSymbol} was absent from authoritative Spot universe truth`);
    const focusedArrivals = focusCounters.aggregateTrade + focusCounters.depth;
    report('focused_trade_or_depth', focusedArrivals > 0 ? 'PASS' : focus.state === 'BLOCKED' ? 'BLOCKED' : 'UNAVAILABLE', `${focusCounters.aggregateTrade} aggregate-trade and ${focusCounters.depth} depth messages observed`);
    report('normalized_evidence', normalizedEvidenceCount > 0 ? 'PASS' : 'UNAVAILABLE', `${normalizedEvidenceCount} foundation-normalized public evidence records produced`);

    let runtimeSnapshot = null;
    try {
      const spotSnapshot = spot.snapshot(observationTimeMs);
      const futuresSnapshot = futures.snapshot(observationTimeMs);
      const focusRequirements = [
        { kind: 'AGG_TRADE', ready: focusCounters.aggregateTrade > 0 },
        { kind: 'BOOK_TICKER', ready: focusCounters.bookTicker > 0 },
        { kind: 'DEPTH', ready: focusCounters.depth > 0 },
      ];
      runtimeSnapshot = buildRuntimeIntelligenceSnapshot({
        snapshotTimeMs: observationTimeMs,
        configurationVersion: this.#config.configurationVersion,
        universe,
        spot: spotSnapshot,
        futures: futuresSnapshot,
        sources: [
          ...spotSnapshot.sources.map((source, index) => ({
            component: 'SPOT_BROAD' as const,
            capability: ['broad-mini-ticker', 'focused-book-ticker', 'focused-aggregate-trade'][index] ?? 'spot-public',
            criticality: index === 0 ? 'CORE' as const : 'FOCUSED' as const,
            source,
          })),
          ...futuresSnapshot.sources.slice(0, 2).map((source, index) => ({
            component: 'FUTURES_BROAD' as const,
            capability: index === 0 ? 'broad-book-ticker' : 'mark-funding',
            criticality: 'CORE' as const,
            source,
          })),
        ],
        focus: {
          planId: stableId('public-smoke-focus', { focusSymbol }),
          observedAtMs: observationTimeMs,
          requirements: focusRequirements.map((entry) => ({
            id: stableId('public-smoke-focus-requirement', { focusSymbol, evidenceKind: entry.kind }),
            symbol: focusSymbol,
            evidenceKind: entry.kind,
            protected: false,
            state: entry.ready ? 'READY' as const : focusPresent ? 'WARMING' as const : 'UNFULFILLED' as const,
            reasonCodes: entry.ready ? [] : [focusPresent ? 'SMOKE_WAITING_FOR_PUBLIC_MESSAGE' : 'FOCUS_SYMBOL_NOT_IN_UNIVERSE'],
          })),
          counts: {
            requirements: focusRequirements.length,
            readyRequirements: focusRequirements.filter((entry) => entry.ready).length,
            warmingRequirements: focusPresent ? focusRequirements.filter((entry) => !entry.ready).length : 0,
            unfulfilledRequirements: focusPresent ? 0 : focusRequirements.length,
            pendingControlMessages: 0,
            retainedByHysteresis: 0,
          },
        },
        policy: { requiredComponents: ['UNIVERSE', 'SPOT_BROAD', 'FUTURES_BROAD'] },
      });
      const healthState: PublicSmokeStepState = runtimeSnapshot.observedState === 'HEALTHY' && requiredSourcesHealthy
        ? 'PASS'
        : runtimeSnapshot.observedState === 'BLOCKED' || [spotBroad, usdMBook, usdMMark].some((source) => source.state === 'BLOCKED')
          ? 'BLOCKED'
          : 'UNAVAILABLE';
      report('final_runtime_health', healthState, `runtime snapshot is ${runtimeSnapshot.observedState} with ${runtimeSnapshot.blockerCount} blockers and ${runtimeSnapshot.warningCount} warnings; required public sources healthy=${requiredSourcesHealthy}`);
    } catch (error) {
      fatalError = boundedError(error instanceof Error ? error.message : error, this.#config.maximumErrorLength, 'runtime snapshot failed');
      report('final_runtime_health', 'FAIL', fatalError);
    }
    report('no_credentials_or_money_actions', 'PASS', 'all endpoints are public, credentials are impossible in the transport contract, and mutation authority is NONE');

    const createdConnections = sources.filter((source) => source.connection !== null).length;
    const openedConnections = sources.filter((source) => source.openedAtMs !== null).length;
    shutdownStarted = true;
    for (const source of sources) {
      if (source.connection === null) continue;
      requestSourceClose(source, 'manual public smoke complete');
    }
    if (this.#config.shutdownGraceMs > 0) {
      try { await this.#options.wait.wait(this.#config.shutdownGraceMs); } catch {
        fatalError ??= 'smoke shutdown wait failed';
      }
    }
    spot.stop();
    futures.stopAll();
    const observedCloses = sources.filter((source) => source.closeObserved).length;
    const allConnectionsClosed = sources
      .filter((source) => source.connection !== null)
      .every((source) => source.closeObserved);
    const shutdown: PublicSmokeShutdownSummary = Object.freeze({
      requested: true,
      createdConnections,
      openedConnections,
      closeRequests,
      observedCloses,
      allConnectionsClosed,
    });
    report('clean_shutdown', allConnectionsClosed ? 'PASS' : 'FAIL', `${observedCloses}/${createdConnections} created public transports emitted close`);

    const finishedAtMs = this.#now();
    const finalSources = sources.map((source) => sourceSnapshot(
      source,
      finishedAtMs,
      this.#config.maximumAcceptedMessageAgeMs,
    ));
    const outcome = this.#outcome({
      universe: universeView,
      sources: finalSources,
      focusPresent,
      focusedArrivals,
      normalizedEvidenceCount,
      runtimeState: runtimeSnapshot?.observedState ?? null,
      shutdownClean: allConnectionsClosed,
      fatalError,
    });
    const material = {
      configurationVersion: this.#config.configurationVersion,
      startedAtMs,
      finishedAtMs,
      durationMs,
      focusSymbol,
      outcome,
      universe: universeView,
      sources: finalSources,
      normalizedEvidenceIds: normalizedIds,
      runtimeSnapshotId: runtimeSnapshot?.id ?? null,
      steps,
      shutdown,
    };
    return deepFreeze({
      id: stableId('public-no-key-smoke-result', material),
      schemaVersion: '1' as const,
      configurationVersion: this.#config.configurationVersion,
      startedAtMs,
      finishedAtMs,
      requestedDurationMs: durationMs,
      outcome,
      manualOnly: true as const,
      credentialsUsed: false as const,
      privateEndpointsUsed: false as const,
      moneyActionAuthority: 'NONE' as const,
      focusSymbol,
      universe: universeView,
      sources: finalSources,
      normalizedEvidenceCount,
      normalizedEvidenceIds: normalizedIds.sort(codePointCompare),
      truncatedNormalizedEvidenceIds,
      runtimeSnapshot,
      steps,
      shutdown,
    });
  }

  #outcome(input: {
    universe: PublicSmokeUniverseSummary;
    sources: readonly PublicSmokeSourceSnapshot[];
    focusPresent: boolean;
    focusedArrivals: number;
    normalizedEvidenceCount: number;
    runtimeState: 'STOPPED' | 'WARMING' | 'HEALTHY' | 'DEGRADED' | 'BLOCKED' | null;
    shutdownClean: boolean;
    fatalError: string | null;
  }): PublicSmokeOutcome {
    if (input.fatalError !== null || !input.shutdownClean) return 'FAIL';
    const required = input.sources.filter((source) => source.required);
    if (required.some((source) => source.state === 'FAILED')) return 'FAIL';
    const requiredLive = required.filter((source) => (
      source.acceptedMessageCount > 0
      && source.fresh
      && !source.endedBeforeShutdown
      && source.state !== 'BLOCKED'
      && source.state !== 'UNAVAILABLE'
      && source.state !== 'FAILED'
    )).length;
    const blocked = input.universe.blocked || required.some((source) => source.state === 'BLOCKED');
    if (input.runtimeState === 'BLOCKED') return 'BLOCKED';
    if (input.universe.state === 'COMPLETE'
      && requiredLive === required.length
      && input.focusPresent
      && input.focusedArrivals > 0
      && input.normalizedEvidenceCount > 0
      && input.runtimeState === 'HEALTHY') return 'PASS';
    if (requiredLive === 0 && input.universe.nodeCount === 0 && blocked) return 'BLOCKED';
    if (requiredLive > 0 || input.universe.nodeCount > 0 || input.normalizedEvidenceCount > 0) return 'PARTIAL';
    return blocked ? 'BLOCKED' : 'UNAVAILABLE';
  }

  #now(): number {
    return safeInteger(this.#options.clock.nowMs(), 'clock.nowMs');
  }
}
