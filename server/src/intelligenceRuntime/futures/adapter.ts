import {
  canonicalJson,
  makeStableFailure,
  stableId,
  type NormalizedEvidence,
  type StableFailure,
} from '../../intelligenceFoundation/contracts/index.js';
import {
  BINANCE_SOURCE_FACTS,
  normalizeBookTicker,
  normalizeFunding,
  normalizeMarkPrice,
} from '../../intelligenceFoundation/evidence/index.js';
import {
  RUNTIME_ENDPOINTS,
  SourceLifecycleTracker,
  sourceDefinition,
  type RuntimeClock,
  type RuntimeSourceDefinition,
  type RuntimeSourceEvent,
  type RuntimeSourceSnapshot,
} from '../contracts/index.js';
import {
  decodeUsdMBookTicker,
  decodeUsdMContractInfo,
  decodeUsdMLiquidationContext,
  decodeUsdMMarkFunding,
  type FuturesDecodeOptions,
} from './decode.js';
import {
  FUTURES_FEEDS,
  FUTURES_RUNTIME_HARD_LIMITS,
  type FuturesBookTickerObservation,
  type FuturesContractObservation,
  type FuturesDecodeBatch,
  type FuturesDecodeIssue,
  type FuturesFeed,
  type FuturesIngestResult,
  type FuturesInstrumentSeed,
  type FuturesInstrumentResolver,
  type FuturesLiquidationObservation,
  type FuturesMarkFundingObservation,
  type FuturesNormalizedEmission,
  type FuturesObservation,
  type FuturesObservationSlot,
  type FuturesRuntimeSnapshot,
  type FuturesStreamDescriptor,
  type FuturesSymbolSnapshot,
  type UsdMRuntimeIdentity,
} from './types.js';

export const FUTURES_STREAMS = Object.freeze({
  BOOK_TICKER: Object.freeze({
    feed: 'BOOK_TICKER',
    endpointClass: 'PUBLIC',
    baseUrl: RUNTIME_ENDPOINTS.USD_M_PUBLIC_WEBSOCKET.baseUrl,
    stream: '!bookTicker',
    url: `${RUNTIME_ENDPOINTS.USD_M_PUBLIC_WEBSOCKET.baseUrl}/ws/!bookTicker`,
  }),
  MARK_FUNDING: Object.freeze({
    feed: 'MARK_FUNDING',
    endpointClass: 'MARKET',
    baseUrl: RUNTIME_ENDPOINTS.USD_M_MARKET_WEBSOCKET.baseUrl,
    stream: '!markPrice@arr@1s',
    url: `${RUNTIME_ENDPOINTS.USD_M_MARKET_WEBSOCKET.baseUrl}/ws/!markPrice@arr@1s`,
  }),
  CONTRACT_INFO: Object.freeze({
    feed: 'CONTRACT_INFO',
    endpointClass: 'MARKET',
    baseUrl: RUNTIME_ENDPOINTS.USD_M_MARKET_WEBSOCKET.baseUrl,
    stream: '!contractInfo',
    url: `${RUNTIME_ENDPOINTS.USD_M_MARKET_WEBSOCKET.baseUrl}/ws/!contractInfo`,
  }),
  LIQUIDATION: Object.freeze({
    feed: 'LIQUIDATION',
    endpointClass: 'MARKET',
    baseUrl: RUNTIME_ENDPOINTS.USD_M_MARKET_WEBSOCKET.baseUrl,
    stream: '!forceOrder@arr',
    url: `${RUNTIME_ENDPOINTS.USD_M_MARKET_WEBSOCKET.baseUrl}/ws/!forceOrder@arr`,
  }),
} as const satisfies Record<FuturesFeed, FuturesStreamDescriptor>);

const DEFAULT_SOURCE_THRESHOLDS = Object.freeze({
  BOOK_TICKER: Object.freeze({ silentAfterMs: 7_500, staleAfterMs: 15_000, authority: 'COMPLETE' as const }),
  MARK_FUNDING: Object.freeze({ silentAfterMs: 3_000, staleAfterMs: 6_000, authority: 'COMPLETE' as const }),
  CONTRACT_INFO: Object.freeze({ silentAfterMs: 30_000, staleAfterMs: 120_000, authority: 'PARTIAL' as const }),
  LIQUIDATION: Object.freeze({ silentAfterMs: 30_000, staleAfterMs: 120_000, authority: 'SAMPLED' as const }),
});

export interface FuturesRuntimeAdapterOptions extends FuturesDecodeOptions {
  maximumSymbols?: number;
  maximumLiquidations?: number;
  maximumRecordsPerMessage?: number;
  symbolStaleAfterMs?: number;
  evidenceMaxAgeMs?: number;
  retryCeiling?: number;
  instrumentResolver?: FuturesInstrumentResolver;
}

interface InternalSlot<T extends FuturesObservation> {
  observation: T;
  generation: number;
}

interface InternalSymbol {
  identity: UsdMRuntimeIdentity;
  book: InternalSlot<FuturesBookTickerObservation> | null;
  markFunding: InternalSlot<FuturesMarkFundingObservation> | null;
  contract: InternalSlot<FuturesContractObservation> | null;
  lastUsefulReceiveTimeMs: number;
}

interface InternalLiquidationSlot extends InternalSlot<FuturesLiquidationObservation> {
  eventId: string;
}

interface LiquidationCursor {
  sourceTimeMs: number;
  eventId: string;
}

interface ApplyResult {
  outcome: 'ACCEPTED' | 'DUPLICATE' | 'OUT_OF_ORDER' | 'INVALID' | 'DROPPED';
  previousSequence: string | null;
  evicted: number;
  issue: FuturesDecodeIssue | null;
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
  hardMaximum: number,
  allowZero = false,
): number {
  const resolved = value ?? fallback;
  const valid = Number.isSafeInteger(resolved) && (allowZero ? resolved >= 0 : resolved > 0);
  if (!valid) throw new TypeError(`${name} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`);
  if (resolved > hardMaximum) throw new RangeError(`${name} exceeds hard maximum ${hardMaximum}`);
  return resolved;
}

function runtimeIssue(
  code: FuturesDecodeIssue['code'],
  field: string | null,
  message: string,
): FuturesDecodeIssue {
  return Object.freeze({ code, recordIndex: null, field, message });
}

function makeDefinition(feed: FuturesFeed, maximumFutureSkewMs: number, retryCeiling: number): RuntimeSourceDefinition {
  const descriptor = FUTURES_STREAMS[feed];
  const thresholds = DEFAULT_SOURCE_THRESHOLDS[feed];
  return sourceDefinition({
    capability: `usd-m-${feed.toLowerCase().replaceAll('_', '-')}`,
    streamOrPath: descriptor.stream,
    transportKind: 'WEBSOCKET',
    endpointClass: descriptor.endpointClass,
    productFamily: 'USD_M_PERPETUAL',
    silentAfterMs: thresholds.silentAfterMs,
    staleAfterMs: thresholds.staleAfterMs,
    maximumFutureSkewMs,
    retryCeiling,
    authority: thresholds.authority,
  });
}

function compareDecimalIds(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function withoutField(
  record: Readonly<Record<string, unknown>>,
  excludedField: string,
): Readonly<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (key !== excludedField) output[key] = record[key];
  }
  return Object.freeze(output);
}

function sameIdentity(left: UsdMRuntimeIdentity, right: UsdMRuntimeIdentity): boolean {
  return left.symbol === right.symbol
    && left.pair === right.pair
    && left.sourceMarketType === right.sourceMarketType
    && left.marketSegment === right.marketSegment
    && left.productFamily === right.productFamily;
}

function freezeFailures(failures: readonly StableFailure[]): readonly StableFailure[] {
  return Object.freeze(failures.map((failure) => Object.freeze({
    ...failure,
    evidenceIds: [...failure.evidenceIds],
  })));
}

function emission(
  correlationId: string,
  evidenceKind: FuturesNormalizedEmission['evidenceKind'],
  result: { ok: true; value: NormalizedEvidence; qualityFailures: StableFailure[] }
    | { ok: false; failures: StableFailure[] },
): FuturesNormalizedEmission {
  return result.ok
    ? Object.freeze({
      correlationId,
      evidenceKind,
      status: 'NORMALIZED' as const,
      evidence: result.value,
      qualityFailures: freezeFailures(result.qualityFailures),
    })
    : Object.freeze({
      correlationId,
      evidenceKind,
      status: 'REJECTED' as const,
      evidence: null,
      qualityFailures: freezeFailures(result.failures),
    });
}

function unavailableEmission(
  correlationId: string,
  evidenceKind: FuturesNormalizedEmission['evidenceKind'],
  message: string,
): FuturesNormalizedEmission {
  return Object.freeze({
    correlationId,
    evidenceKind,
    status: 'INSTRUMENT_UNAVAILABLE' as const,
    evidence: null,
    qualityFailures: freezeFailures([
      makeStableFailure('UNAVAILABLE', 'runtime.futures.normalization', message, 'instrument'),
    ]),
  });
}

export class FuturesRuntimeAdapter {
  readonly #clock: RuntimeClock;
  readonly #maximumSymbols: number;
  readonly #maximumLiquidations: number;
  readonly #maximumRecordsPerMessage: number;
  readonly #maximumContractBrackets: number;
  readonly #symbolStaleAfterMs: number;
  readonly #evidenceMaxAgeMs: number;
  readonly #maximumFutureSkewMs: number;
  readonly #resolver: FuturesInstrumentResolver | null;
  readonly #definitions: Record<FuturesFeed, RuntimeSourceDefinition>;
  readonly #trackers: Record<FuturesFeed, SourceLifecycleTracker>;
  readonly #symbols = new Map<string, InternalSymbol>();
  readonly #liquidations: InternalLiquidationSlot[] = [];
  readonly #liquidationIds = new Set<string>();
  readonly #liquidationCursors = new Map<string, LiquidationCursor>();

  constructor(clock: RuntimeClock, options: FuturesRuntimeAdapterOptions = {}) {
    if (typeof clock?.nowMs !== 'function') throw new TypeError('runtime clock is required');
    this.#clock = clock;
    this.#maximumSymbols = boundedPositiveInteger(
      options.maximumSymbols, 2_048, 'maximumSymbols', FUTURES_RUNTIME_HARD_LIMITS.maximumSymbols,
    );
    this.#maximumLiquidations = boundedPositiveInteger(
      options.maximumLiquidations, 2_048, 'maximumLiquidations', FUTURES_RUNTIME_HARD_LIMITS.maximumLiquidations, true,
    );
    this.#maximumRecordsPerMessage = boundedPositiveInteger(
      options.maximumRecordsPerMessage, 4_096, 'maximumRecordsPerMessage', FUTURES_RUNTIME_HARD_LIMITS.maximumRecordsPerMessage,
    );
    this.#maximumContractBrackets = boundedPositiveInteger(
      options.maximumContractBrackets, 128, 'maximumContractBrackets', FUTURES_RUNTIME_HARD_LIMITS.maximumContractBrackets,
    );
    this.#symbolStaleAfterMs = boundedPositiveInteger(
      options.symbolStaleAfterMs, 15_000, 'symbolStaleAfterMs', FUTURES_RUNTIME_HARD_LIMITS.symbolStaleAfterMs,
    );
    this.#evidenceMaxAgeMs = boundedPositiveInteger(
      options.evidenceMaxAgeMs, 15_000, 'evidenceMaxAgeMs', FUTURES_RUNTIME_HARD_LIMITS.evidenceMaxAgeMs,
    );
    this.#maximumFutureSkewMs = boundedPositiveInteger(
      options.maximumFutureSkewMs, 2_000, 'maximumFutureSkewMs', FUTURES_RUNTIME_HARD_LIMITS.maximumFutureSkewMs, true,
    );
    const retryCeiling = boundedPositiveInteger(
      options.retryCeiling, 12, 'retryCeiling', FUTURES_RUNTIME_HARD_LIMITS.retryCeiling, true,
    );
    this.#resolver = options.instrumentResolver ?? null;
    this.#definitions = {
      BOOK_TICKER: makeDefinition('BOOK_TICKER', this.#maximumFutureSkewMs, retryCeiling),
      MARK_FUNDING: makeDefinition('MARK_FUNDING', this.#maximumFutureSkewMs, retryCeiling),
      CONTRACT_INFO: makeDefinition('CONTRACT_INFO', this.#maximumFutureSkewMs, retryCeiling),
      LIQUIDATION: makeDefinition('LIQUIDATION', this.#maximumFutureSkewMs, retryCeiling),
    };
    this.#trackers = {
      BOOK_TICKER: new SourceLifecycleTracker(this.#definitions.BOOK_TICKER, clock),
      MARK_FUNDING: new SourceLifecycleTracker(this.#definitions.MARK_FUNDING, clock),
      CONTRACT_INFO: new SourceLifecycleTracker(this.#definitions.CONTRACT_INFO, clock),
      LIQUIDATION: new SourceLifecycleTracker(this.#definitions.LIQUIDATION, clock),
    };
  }

  sourceDefinition(feed: FuturesFeed): RuntimeSourceDefinition {
    return this.#definitions[feed];
  }

  start(feed: FuturesFeed): number {
    return this.#trackers[feed].start();
  }

  startAll(): Readonly<Record<FuturesFeed, number>> {
    return Object.freeze({
      BOOK_TICKER: this.start('BOOK_TICKER'),
      MARK_FUNDING: this.start('MARK_FUNDING'),
      CONTRACT_INFO: this.start('CONTRACT_INFO'),
      LIQUIDATION: this.start('LIQUIDATION'),
    });
  }

  connected(feed: FuturesFeed, generation: number, connectedAtMs = this.#clock.nowMs()): boolean {
    return this.#trackers[feed].connected(generation, connectedAtMs);
  }

  reconnect(feed: FuturesFeed): number {
    return this.#trackers[feed].reconnect();
  }

  stop(feed: FuturesFeed): void {
    this.#trackers[feed].stop();
  }

  stopAll(): void {
    for (const feed of FUTURES_FEEDS) this.stop(feed);
  }

  ingest(feed: FuturesFeed, generation: number, raw: unknown, receiveTimeMs: number): FuturesIngestResult {
    const decoded = this.#decode(feed, raw, receiveTimeMs);
    const tracker = this.#trackers[feed];
    const issues = [...decoded.issues];
    const events: RuntimeSourceEvent<FuturesObservation>[] = [];
    const normalized: FuturesNormalizedEmission[] = [];
    let invalid = decoded.issues.filter((entry) => entry.code !== 'CAPACITY_EXCEEDED').length;
    let duplicate = 0;
    let outOfOrder = 0;
    let dropped = decoded.overflow.records + (decoded.overflow.contractBrackets > 0 ? 1 : 0);
    let trackedDropped = 0;
    let frameSourceTimeMs: number | null = null;

    const clockNow = this.#clock.nowMs();
    if (!Number.isSafeInteger(clockNow) || clockNow < receiveTimeMs) {
      issues.push(runtimeIssue('INVALID_FIELD', 'receiveTimeMs', 'Injected clock must be a safe integer at or after receiveTimeMs'));
      invalid += 1;
      dropped += decoded.observations.length;
    } else {
      const before = tracker.snapshot(clockNow);
      const currentGeneration = before.desiredState === 'RUNNING'
        && before.connectedAtMs !== null
        && before.connectionGeneration === generation;
      if (!currentGeneration) {
        dropped += decoded.observations.length;
      } else {
        trackedDropped += decoded.overflow.records + (decoded.overflow.contractBrackets > 0 ? 1 : 0);
        const receiveTimeRegressed = decoded.observations.length > 0
          && before.lastMessageReceiveTimeMs !== null
          && receiveTimeMs < before.lastMessageReceiveTimeMs;
        if (receiveTimeRegressed) {
          outOfOrder += decoded.observations.length;
          issues.push(runtimeIssue(
            'RECEIVE_TIME_REGRESSION',
            'receiveTimeMs',
            'Futures frame receive time precedes the last accepted useful frame',
          ));
        } else {
          for (const observation of decoded.observations) {
            const applied = this.#apply(observation, generation);
            dropped += applied.evicted;
            trackedDropped += applied.evicted;
            if (applied.outcome === 'DUPLICATE') {
              duplicate += 1;
              continue;
            }
            if (applied.outcome === 'OUT_OF_ORDER') {
              outOfOrder += 1;
              continue;
            }
            if (applied.outcome === 'DROPPED') {
              dropped += 1;
              trackedDropped += 1;
              if (applied.issue) issues.push(applied.issue);
              continue;
            }
            if (applied.outcome === 'INVALID') {
              invalid += 1;
              if (applied.issue) issues.push(applied.issue);
              continue;
            }
            const observationSourceTimeMs = observation.sourceTransactionTimeMs ?? observation.sourceEventTimeMs;
            frameSourceTimeMs = frameSourceTimeMs === null
              ? observationSourceTimeMs
              : Math.max(frameSourceTimeMs, observationSourceTimeMs);
            const event = this.#event(feed, generation, observation, applied.previousSequence);
            events.push(event);
            normalized.push(...this.#normalize(event));
          }
        }
      }
    }

    if (frameSourceTimeMs !== null) {
      const generationAccepted = tracker.message({ generation, sourceTimeMs: frameSourceTimeMs, receiveTimeMs });
      if (!generationAccepted) {
        throw new Error('Futures lifecycle generation changed during synchronous accepted-frame processing');
      }
      tracker.processed(generation, clockNow);
    }
    let currentAfter = false;
    if (Number.isSafeInteger(clockNow) && clockNow >= 0) {
      const after = tracker.snapshot(clockNow);
      currentAfter = after.desiredState === 'RUNNING' && after.connectionGeneration === generation;
    }
    if (currentAfter) {
      if (invalid > 0) tracker.count('invalid', invalid);
      if (duplicate > 0) tracker.count('duplicate', duplicate);
      if (outOfOrder > 0) tracker.count('outOfOrder', outOfOrder);
      if (trackedDropped > 0) tracker.count('dropped', trackedDropped);
    }

    return Object.freeze({
      feed,
      generation,
      accepted: events.length,
      ignored: decoded.ignored.length,
      invalid,
      duplicate,
      outOfOrder,
      dropped,
      overflowRecords: decoded.overflow.records,
      overflowContractBrackets: decoded.overflow.contractBrackets,
      issues: Object.freeze(issues),
      events: Object.freeze(events),
      normalized: Object.freeze(normalized),
    });
  }

  snapshot(atMs = this.#clock.nowMs()): FuturesRuntimeSnapshot {
    if (!Number.isSafeInteger(atMs) || atMs < 0) throw new TypeError('snapshot time must be a non-negative safe integer');
    const sourceSnapshots = Object.freeze(FUTURES_FEEDS.map((feed) => this.#sourceSnapshot(feed, atMs)));
    const generations: Record<FuturesFeed, number> = {
      BOOK_TICKER: sourceSnapshots[0]?.connectionGeneration ?? 0,
      MARK_FUNDING: sourceSnapshots[1]?.connectionGeneration ?? 0,
      CONTRACT_INFO: sourceSnapshots[2]?.connectionGeneration ?? 0,
      LIQUIDATION: sourceSnapshots[3]?.connectionGeneration ?? 0,
    };
    const symbols = [...this.#symbols.values()]
      .sort((left, right) => codePointCompare(left.identity.symbol, right.identity.symbol))
      .map((state) => this.#symbolSnapshot(state, atMs, generations));
    const liquidations = this.#liquidations.map((slot) => this.#slotSnapshot(
      slot,
      atMs,
      generations.LIQUIDATION ?? 0,
    ));
    return Object.freeze({
      snapshotTimeMs: atMs,
      sources: sourceSnapshots,
      symbols: Object.freeze(symbols),
      liquidations: Object.freeze(liquidations),
      symbolCapacity: this.#maximumSymbols,
      liquidationCapacity: this.#maximumLiquidations,
    });
  }

  #sourceSnapshot(feed: FuturesFeed, atMs: number): RuntimeSourceSnapshot {
    const snapshot = this.#trackers[feed].snapshot(atMs);
    const sourceTimeMs = snapshot.lastMessageSourceTimeMs;
    if (
      sourceTimeMs !== null
      && snapshot.desiredState === 'RUNNING'
      && (snapshot.observedState === 'LIVE' || snapshot.observedState === 'DEGRADED')
      && Math.max(0, atMs - sourceTimeMs) >= this.#definitions[feed].staleAfterMs
    ) {
      return Object.freeze({
        ...snapshot,
        observedState: 'STALE',
        completeness: 'PARTIAL',
        recommendedAction: 'Refresh or reconnect the source; its authoritative exchange timestamp is stale.',
      });
    }
    return snapshot;
  }

  #decode(feed: FuturesFeed, raw: unknown, receiveTimeMs: number): FuturesDecodeBatch<FuturesObservation> {
    const options = {
      maximumFutureSkewMs: this.#maximumFutureSkewMs,
      maximumRecordsPerMessage: this.#maximumRecordsPerMessage,
      maximumContractBrackets: this.#maximumContractBrackets,
    };
    if (feed === 'BOOK_TICKER') return decodeUsdMBookTicker(raw, receiveTimeMs, options);
    if (feed === 'MARK_FUNDING') return decodeUsdMMarkFunding(raw, receiveTimeMs, options);
    if (feed === 'CONTRACT_INFO') return decodeUsdMContractInfo(raw, receiveTimeMs, options);
    return decodeUsdMLiquidationContext(raw, receiveTimeMs, options);
  }

  #ensureSymbol(observation: FuturesObservation): { state: InternalSymbol | null; issue: FuturesDecodeIssue | null } {
    const existing = this.#symbols.get(observation.symbol);
    if (existing) {
      if (!sameIdentity(existing.identity, observation)) {
        return {
          state: null,
          issue: runtimeIssue('IDENTITY_CONFLICT', 'ps', 'Official ps identity changed for an existing Futures symbol'),
        };
      }
      if (observation.pairAuthority === 'OFFICIAL_PS'
        && existing.identity.pairAuthority !== 'OFFICIAL_PS') {
        existing.identity = Object.freeze({ ...existing.identity, pairAuthority: 'OFFICIAL_PS' });
      }
      return { state: existing, issue: null };
    }
    if (this.#symbols.size >= this.#maximumSymbols) {
      return {
        state: null,
        issue: runtimeIssue('CAPACITY_EXCEEDED', 'symbol', 'Bounded Futures symbol capacity is exhausted'),
      };
    }
    const requiresResolution = observation.pairAuthority !== 'OFFICIAL_PS'
      || observation.symbol !== observation.pair;
    if (requiresResolution && this.#resolveInstrument(observation) === null) {
      return {
        state: null,
        issue: runtimeIssue(
          'IDENTITY_CONFLICT',
          observation.pairAuthority === 'OFFICIAL_PS' ? 'ps' : 's',
          'Symbol-only or non-canonical USD-M identity requires confirmation from the injected Perpetual universe resolver',
        ),
      };
    }
    const state: InternalSymbol = {
      identity: Object.freeze({
        symbol: observation.symbol,
        pair: observation.pair,
        pairAuthority: requiresResolution ? 'INJECTED_RESOLVER' : 'OFFICIAL_PS',
        sourceMarketType: 1,
        marketSegment: 'USD_M',
        productFamily: 'USD_M_PERPETUAL',
      }),
      book: null,
      markFunding: null,
      contract: null,
      lastUsefulReceiveTimeMs: observation.receiveTimeMs,
    };
    this.#symbols.set(observation.symbol, state);
    return { state, issue: null };
  }

  #apply(observation: FuturesObservation, generation: number): ApplyResult {
    if (observation.kind === 'USD_M_LIQUIDATION_CONTEXT' && this.#maximumLiquidations === 0) {
      return {
        outcome: 'DROPPED',
        previousSequence: null,
        evicted: 0,
        issue: runtimeIssue('CAPACITY_EXCEEDED', 'liquidations', 'Liquidation retention is disabled'),
      };
    }
    const ensured = this.#ensureSymbol(observation);
    if (!ensured.state) {
      return {
        outcome: ensured.issue?.code === 'CAPACITY_EXCEEDED' ? 'DROPPED' : 'INVALID',
        previousSequence: null,
        evicted: 0,
        issue: ensured.issue,
      };
    }
    const state = ensured.state;
    if (observation.kind === 'USD_M_BOOK_TICKER') {
      const prior = state.book;
      const previousSequence = prior?.generation === generation ? prior.observation.updateId : null;
      if (prior !== null) {
        const sourceTimeMs = observation.sourceTransactionTimeMs ?? observation.sourceEventTimeMs;
        const priorSourceTimeMs = prior.observation.sourceTransactionTimeMs ?? prior.observation.sourceEventTimeMs;
        if (sourceTimeMs < priorSourceTimeMs) {
          return { outcome: 'OUT_OF_ORDER', previousSequence, evicted: 0, issue: null };
        }
        const order = compareDecimalIds(observation.updateId, prior.observation.updateId);
        if (order === 0) {
          if (canonicalJson(observation.rawRecord) === canonicalJson(prior.observation.rawRecord)) {
            return { outcome: 'DUPLICATE', previousSequence, evicted: 0, issue: null };
          }
          return {
            outcome: 'INVALID',
            previousSequence,
            evicted: 0,
            issue: runtimeIssue('IDENTITY_CONFLICT', 'u', 'A retained Futures book update ID was replayed with different content'),
          };
        }
        if (order < 0) return { outcome: 'OUT_OF_ORDER', previousSequence, evicted: 0, issue: null };
      }
      state.lastUsefulReceiveTimeMs = Math.max(state.lastUsefulReceiveTimeMs, observation.receiveTimeMs);
      state.book = { observation, generation };
      return { outcome: 'ACCEPTED', previousSequence, evicted: 0, issue: null };
    }
    if (observation.kind === 'USD_M_MARK_FUNDING') {
      const prior = state.markFunding;
      if (prior !== null) {
        if (observation.sourceEventTimeMs < prior.observation.sourceEventTimeMs) {
          return { outcome: 'OUT_OF_ORDER', previousSequence: null, evicted: 0, issue: null };
        }
        if (observation.sourceEventTimeMs === prior.observation.sourceEventTimeMs) {
          if (canonicalJson(observation.rawRecord) === canonicalJson(prior.observation.rawRecord)) {
            return { outcome: 'DUPLICATE', previousSequence: null, evicted: 0, issue: null };
          }
          return {
            outcome: 'INVALID',
            previousSequence: null,
            evicted: 0,
            issue: runtimeIssue('IDENTITY_CONFLICT', 'E', 'A retained mark event time was replayed with different content'),
          };
        }
      }
      state.lastUsefulReceiveTimeMs = Math.max(state.lastUsefulReceiveTimeMs, observation.receiveTimeMs);
      state.markFunding = { observation, generation };
      return { outcome: 'ACCEPTED', previousSequence: null, evicted: 0, issue: null };
    }
    if (observation.kind === 'USD_M_CONTRACT_INFO') {
      const prior = state.contract;
      if (prior !== null) {
        if (observation.sourceEventTimeMs < prior.observation.sourceEventTimeMs) {
          return { outcome: 'OUT_OF_ORDER', previousSequence: null, evicted: 0, issue: null };
        }
        if (observation.sourceEventTimeMs === prior.observation.sourceEventTimeMs) {
          if (canonicalJson(observation.rawRecord) === canonicalJson(prior.observation.rawRecord)) {
            return { outcome: 'DUPLICATE', previousSequence: null, evicted: 0, issue: null };
          }
          return {
            outcome: 'INVALID',
            previousSequence: null,
            evicted: 0,
            issue: runtimeIssue('IDENTITY_CONFLICT', 'E', 'A retained contract event time was replayed with different content'),
          };
        }
      }
      state.lastUsefulReceiveTimeMs = Math.max(state.lastUsefulReceiveTimeMs, observation.receiveTimeMs);
      state.contract = { observation, generation };
      return { outcome: 'ACCEPTED', previousSequence: null, evicted: 0, issue: null };
    }
    const eventId = stableId('runtime-liquidation', {
      symbol: observation.symbol,
      pair: observation.pair,
      sourceEventTimeMs: observation.sourceEventTimeMs,
      sourceTransactionTimeMs: observation.sourceTransactionTimeMs,
      side: observation.orderSide,
      quantity: observation.originalQuantity,
      averagePrice: observation.averagePrice,
    });
    if (this.#liquidationIds.has(eventId)) {
      return { outcome: 'DUPLICATE', previousSequence: null, evicted: 0, issue: null };
    }
    const cursor = this.#liquidationCursors.get(observation.symbol);
    const sourceTimeMs = observation.sourceTransactionTimeMs ?? observation.sourceEventTimeMs;
    if (cursor !== undefined) {
      if (sourceTimeMs < cursor.sourceTimeMs) {
        return { outcome: 'OUT_OF_ORDER', previousSequence: null, evicted: 0, issue: null };
      }
      if (sourceTimeMs === cursor.sourceTimeMs) {
        if (eventId === cursor.eventId) {
          return { outcome: 'DUPLICATE', previousSequence: null, evicted: 0, issue: null };
        }
        return {
          outcome: 'INVALID',
          previousSequence: null,
          evicted: 0,
          issue: runtimeIssue('IDENTITY_CONFLICT', 'o.T', 'A retained liquidation source time was replayed with different content'),
        };
      }
    }
    let evicted = 0;
    if (this.#liquidations.length === this.#maximumLiquidations) {
      const removed = this.#liquidations.shift();
      if (removed) this.#liquidationIds.delete(removed.eventId);
      evicted = 1;
    }
    this.#liquidations.push({ observation, generation, eventId });
    this.#liquidationIds.add(eventId);
    this.#liquidationCursors.set(observation.symbol, { sourceTimeMs, eventId });
    state.lastUsefulReceiveTimeMs = Math.max(state.lastUsefulReceiveTimeMs, observation.receiveTimeMs);
    return { outcome: 'ACCEPTED', previousSequence: null, evicted, issue: null };
  }

  #event(
    feed: FuturesFeed,
    generation: number,
    observation: FuturesObservation,
    previousSequence: string | null,
  ): RuntimeSourceEvent<FuturesObservation> {
    const definition = this.#definitions[feed];
    const sequence = observation.kind === 'USD_M_BOOK_TICKER'
      ? Object.freeze({ first: observation.updateId, last: observation.updateId, previous: previousSequence })
      : null;
    const correlationId = stableId('runtime-correlation', {
      sourceId: definition.sourceId,
      connectionGeneration: generation,
      stream: FUTURES_STREAMS[feed].stream,
      kind: observation.kind,
      symbol: observation.symbol,
      pair: observation.pair,
      pairAuthority: observation.pairAuthority,
      sourceEventTimeMs: observation.sourceEventTimeMs,
      sourceTransactionTimeMs: observation.sourceTransactionTimeMs,
      updateId: observation.kind === 'USD_M_BOOK_TICKER' ? observation.updateId : null,
    });
    return Object.freeze({
      sourceId: definition.sourceId,
      connectionGeneration: generation,
      productFamily: 'USD_M_PERPETUAL',
      endpointClass: definition.endpointClass,
      stream: FUTURES_STREAMS[feed].stream,
      sourceEventTimeMs: observation.sourceEventTimeMs,
      sourceTransactionTimeMs: observation.sourceTransactionTimeMs,
      receiveTimeMs: observation.receiveTimeMs,
      sequence,
      correlationId,
      payload: observation,
    });
  }

  #resolveInstrument(observation: FuturesObservation): FuturesInstrumentSeed | null {
    if (!this.#resolver) return null;
    try {
      const resolved = this.#resolver.resolve(observation);
      if (
        resolved === null
        || (resolved.venue !== undefined && resolved.venue !== 'BINANCE')
        || resolved.productFamily !== 'USD_M_PERPETUAL'
        || resolved.symbol !== observation.symbol
        || resolved.pair !== observation.pair
        || resolved.symbol !== resolved.pair
        || resolved.contractType !== 'PERPETUAL'
      ) return null;
      return resolved;
    } catch {
      return null;
    }
  }

  #normalize(event: RuntimeSourceEvent<FuturesObservation>): FuturesNormalizedEmission[] {
    const observation = event.payload;
    if (observation.kind !== 'USD_M_BOOK_TICKER' && observation.kind !== 'USD_M_MARK_FUNDING') return [];
    const instrument = this.#resolveInstrument(observation);
    const evidenceKinds: FuturesNormalizedEmission['evidenceKind'][] = observation.kind === 'USD_M_BOOK_TICKER'
      ? ['BOOK_TICKER']
      : ['MARK_PRICE', 'FUNDING'];
    if (!instrument) {
      return evidenceKinds.map((kind) => unavailableEmission(
        event.correlationId,
        kind,
        'Injected USD-M instrument metadata is required; symbol strings are never parsed into asset identity.',
      ));
    }
    const context = {
      sourceKey: observation.kind === 'USD_M_BOOK_TICKER' ? 'USD_M_BOOK_TICKER' : 'USD_M_MARK_PRICE',
      sourceId: observation.kind === 'USD_M_BOOK_TICKER'
        ? BINANCE_SOURCE_FACTS.USD_M_BOOK_TICKER.sourceId
        : BINANCE_SOURCE_FACTS.USD_M_MARK_PRICE.sourceId,
      endpointClass: observation.kind === 'USD_M_BOOK_TICKER' ? 'PUBLIC' : 'MARKET',
      instrument,
      receivedTimeMs: observation.receiveTimeMs,
      evaluatedAtMs: this.#clock.nowMs(),
      maxAgeMs: this.#evidenceMaxAgeMs,
      maximumFutureSkewMs: this.#maximumFutureSkewMs,
    };
    if (observation.kind === 'USD_M_BOOK_TICKER') {
      const result = normalizeBookTicker(observation.rawRecord, context);
      return [emission(event.correlationId, 'BOOK_TICKER', result)];
    }
    const mark = normalizeMarkPrice(observation.rawRecord, context);
    // `fundingIntervalHours` is runtime-local here. Foundation accepts it only
    // from the separately sourced public /fapi/v1/fundingInfo fragment.
    const funding = normalizeFunding(withoutField(observation.rawRecord, 'fundingIntervalHours'), context);
    return [
      emission(event.correlationId, 'MARK_PRICE', mark),
      emission(event.correlationId, 'FUNDING', funding),
    ];
  }

  #slotSnapshot<T extends FuturesObservation>(
    slot: InternalSlot<T>,
    atMs: number,
    currentGeneration: number,
  ): FuturesObservationSlot<T> {
    const authoritativeTimeMs = slot.observation.sourceTransactionTimeMs ?? slot.observation.sourceEventTimeMs;
    const ageMs = Math.max(0, atMs - authoritativeTimeMs);
    const freshness = slot.generation !== currentGeneration
      ? 'PRIOR_GENERATION' as const
      : ageMs >= this.#symbolStaleAfterMs
        ? 'STALE' as const
        : 'FRESH' as const;
    return Object.freeze({ observation: slot.observation, generation: slot.generation, ageMs, freshness });
  }

  #symbolSnapshot(
    state: InternalSymbol,
    atMs: number,
    generations: Partial<Record<FuturesFeed, number>>,
  ): FuturesSymbolSnapshot {
    const book = state.book === null ? null : this.#slotSnapshot(state.book, atMs, generations.BOOK_TICKER ?? 0);
    const markFunding = state.markFunding === null
      ? null
      : this.#slotSnapshot(state.markFunding, atMs, generations.MARK_FUNDING ?? 0);
    const contract = state.contract === null
      ? null
      : this.#slotSnapshot(state.contract, atMs, generations.CONTRACT_INFO ?? 0);
    return Object.freeze({
      ...state.identity,
      prices: Object.freeze({
        bidPrice: book?.observation.bidPrice ?? null,
        askPrice: book?.observation.askPrice ?? null,
        lastPrice: null,
        markPrice: markFunding?.observation.markPrice ?? null,
        indexPrice: markFunding?.observation.indexPrice ?? null,
        estimatedSettlementPrice: markFunding?.observation.estimatedSettlementPrice ?? null,
      }),
      fundingRate: markFunding?.observation.fundingRate ?? null,
      fundingIntervalHours: markFunding?.observation.fundingIntervalHours ?? null,
      nextFundingTimeMs: markFunding?.observation.nextFundingTimeMs ?? null,
      book,
      markFunding,
      contract,
      lastUsefulReceiveTimeMs: state.lastUsefulReceiveTimeMs,
    });
  }
}

export function serializeFuturesRuntimeSnapshot(snapshot: FuturesRuntimeSnapshot): string {
  return canonicalJson(snapshot);
}
