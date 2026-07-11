import {
  canonicalJson,
  makeStableFailure,
  stableId,
  validateNormalizedEvidence,
  type DepthLevel,
  type NormalizedDepth,
  type StableFailure,
} from '../../intelligenceFoundation/contracts/index.js';
import type { RuntimeMetric, RuntimeMetricSink, RuntimeSequence } from '../contracts/index.js';
import { calculateBookDepthMetrics, calculateSlippage, unavailableSlippageResult } from './metrics.js';
import type {
  ApplyLocalBookSnapshotInput,
  BookDepthMetrics,
  BookFlowMetrics,
  DepthRuntimeEvent,
  LocalBookCompleteness,
  LocalBookConfig,
  LocalBookCounters,
  LocalBookFlowSample,
  LocalBookOutcome,
  LocalBookOutcomeKind,
  LocalBookPorts,
  LocalBookResyncReason,
  LocalBookResyncRequest,
  LocalBookSnapshot,
  SlippageQuery,
  SlippageResult,
} from './types.js';

interface PreparedDepthEvent {
  event: DepthRuntimeEvent;
  evidence: NormalizedDepth;
  sequence: RuntimeSequence;
  first: bigint;
  last: bigint;
  previous: bigint | null;
  fingerprint: string;
  levelUpdates: number;
}

type PreparedResult =
  | { ok: true; value: PreparedDepthEvent }
  | { ok: false; failure: StableFailure };

interface ApplyResult {
  failure: StableFailure | null;
  reason: LocalBookResyncReason | null;
}

const COMPONENT = 'runtime.local_book';
const MAX_SAFE_BOUND = 100_000;
const MAX_BUFFERED_UPDATES = 1_000_000;
const MAX_TIME_POLICY_MS = 7 * 24 * 60 * 60_000;

function integer(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function boundedText(value: unknown, name: string, maximum = 256): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new TypeError(`${name} must be a bounded non-empty string`);
  }
  return value;
}

function sortedPolicy(values: readonly number[], name: string, maximum: number): readonly number[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 8) {
    throw new TypeError(`${name} must contain between one and eight values`);
  }
  const normalized = [...new Set(values.map((value) => integer(value, name, 1)))].sort((left, right) => left - right);
  if (normalized.length !== values.length || normalized.some((value) => value > maximum)) {
    throw new TypeError(`${name} values must be unique and within the supported bound`);
  }
  return Object.freeze(normalized);
}

function validateConfig(input: LocalBookConfig): Readonly<LocalBookConfig> {
  const sourceId = boundedText(input.sourceId, 'sourceId');
  const snapshotSourceId = boundedText(input.snapshotSourceId, 'snapshotSourceId');
  const deltaSourceId = boundedText(input.deltaSourceId, 'deltaSourceId');
  const instrumentId = boundedText(input.instrumentId, 'instrumentId', 512);
  const symbol = boundedText(input.symbol, 'symbol', 128);
  if (input.productFamily !== 'SPOT' && input.productFamily !== 'USD_M_PERPETUAL') {
    throw new TypeError('local book productFamily must be SPOT or USD_M_PERPETUAL');
  }
  if (input.productFamily === 'SPOT' && input.bookScope !== 'UNKNOWN') {
    throw new TypeError('Spot local depth must preserve UNKNOWN book scope');
  }
  if (input.productFamily === 'USD_M_PERPETUAL' && input.bookScope !== 'STANDARD_NO_RPI') {
    throw new TypeError('standard USD-M local depth must exclude RPI liquidity');
  }
  const officialMaximum = input.productFamily === 'SPOT' ? 5_000 : 1_000;
  const snapshotLimit = integer(input.snapshotLimit, 'snapshotLimit', 1);
  const maximumLevelsPerSide = integer(input.maximumLevelsPerSide, 'maximumLevelsPerSide', 1);
  if (snapshotLimit > officialMaximum || maximumLevelsPerSide > snapshotLimit) {
    throw new RangeError('local book level policy exceeds the official snapshot bound');
  }
  const maximumBufferedEvents = integer(input.maximumBufferedEvents, 'maximumBufferedEvents', 1);
  const maximumBufferedLevelUpdates = integer(input.maximumBufferedLevelUpdates, 'maximumBufferedLevelUpdates', 1);
  const maximumRecentFingerprints = integer(input.maximumRecentFingerprints, 'maximumRecentFingerprints', 1);
  const maximumFlowSamples = integer(input.maximumFlowSamples, 'maximumFlowSamples', 1);
  if (maximumBufferedEvents > MAX_SAFE_BOUND || maximumBufferedLevelUpdates > MAX_BUFFERED_UPDATES
    || maximumRecentFingerprints > MAX_SAFE_BOUND || maximumFlowSamples > MAX_SAFE_BOUND) {
    throw new RangeError('local book retention policy exceeds the hard safety bound');
  }
  const staleAfterMs = integer(input.staleAfterMs, 'staleAfterMs', 1);
  const maximumSnapshotApplyAgeMs = integer(input.maximumSnapshotApplyAgeMs, 'maximumSnapshotApplyAgeMs', 1);
  const maximumFutureSkewMs = integer(input.maximumFutureSkewMs, 'maximumFutureSkewMs');
  if (staleAfterMs > MAX_TIME_POLICY_MS || maximumSnapshotApplyAgeMs > MAX_TIME_POLICY_MS
    || maximumFutureSkewMs > 60_000) {
    throw new RangeError('local book time policy exceeds the hard safety bound');
  }
  return Object.freeze({
    ...input,
    sourceId,
    snapshotSourceId,
    deltaSourceId,
    instrumentId,
    symbol,
    snapshotLimit,
    maximumLevelsPerSide,
    maximumBufferedEvents,
    maximumBufferedLevelUpdates,
    maximumRecentFingerprints,
    maximumFlowSamples,
    staleAfterMs,
    maximumSnapshotApplyAgeMs,
    maximumFutureSkewMs,
    depthBandsBps: sortedPolicy(input.depthBandsBps, 'depthBandsBps', 10_000),
    flowWindowsMs: sortedPolicy(input.flowWindowsMs, 'flowWindowsMs', 24 * 60 * 60_000),
  });
}

function sameSequence(left: RuntimeSequence | null, right: RuntimeSequence | null): boolean {
  return left !== null && right !== null
    && left.first === right.first && left.last === right.last && left.previous === right.previous;
}

function cloneSequence(sequence: RuntimeSequence | null): RuntimeSequence | null {
  return sequence === null ? null : Object.freeze({ ...sequence });
}

function frozenFailure(failure: StableFailure | null): StableFailure | null {
  return failure === null ? null : Object.freeze({ ...failure, evidenceIds: Object.freeze([...failure.evidenceIds]) as string[] });
}

function finiteSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) return null;
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function outcome(
  kind: LocalBookOutcomeKind,
  accepted: boolean,
  cursor: string | null,
  options: {
    appliedEvents?: number;
    ignoredEvents?: number;
    failure?: StableFailure | null;
    resyncRequest?: LocalBookResyncRequest | null;
  } = {},
): Readonly<LocalBookOutcome> {
  return Object.freeze({
    kind,
    accepted,
    appliedEvents: options.appliedEvents ?? 0,
    ignoredEvents: options.ignoredEvents ?? 0,
    cursor,
    failure: frozenFailure(options.failure ?? null),
    resyncRequest: options.resyncRequest ?? null,
  });
}

export class LocalOrderBookReducer {
  readonly #config: Readonly<LocalBookConfig>;
  readonly #clock: LocalBookPorts['clock'];
  readonly #metricSink: RuntimeMetricSink | null;
  readonly #bids = new Map<number, number>();
  readonly #asks = new Map<number, number>();
  readonly #buffer: PreparedDepthEvent[] = [];
  readonly #recentFingerprints: string[] = [];
  readonly #recentFingerprintSet = new Set<string>();
  readonly #flowSamples: LocalBookFlowSample[] = [];
  readonly #counters: LocalBookCounters = {
    bufferedCount: 0,
    appliedCount: 0,
    duplicateCount: 0,
    outOfOrderCount: 0,
    sequenceGapCount: 0,
    invalidCount: 0,
    crossedCount: 0,
    resyncCount: 0,
    droppedCount: 0,
    prunedLevelCount: 0,
    bootstrapDiscardedCount: 0,
    flowDroppedCount: 0,
    metricSinkFailureCount: 0,
  };

  #phase: LocalBookSnapshot['phase'] = 'STOPPED';
  #connectionGeneration = 0;
  #syncEpoch = 0;
  #bufferedLevelUpdates = 0;
  #cursor: string | null = null;
  #snapshotSequence: RuntimeSequence | null = null;
  #snapshotReceiveTimeMs: number | null = null;
  #lastDeltaSourceEventTimeMs: number | null = null;
  #lastDeltaSourceTransactionTimeMs: number | null = null;
  #lastDeltaReceiveTimeMs: number | null = null;
  #lastProcessedTimeMs: number | null = null;
  #maximumLevelsKnown: number | null = null;
  #retentionTruncated = false;
  #lastFailure: StableFailure | null = null;
  #pendingResyncRequest: LocalBookResyncRequest | null = null;
  #latestCorrelationId: string | null = null;
  #provenanceDigest: string | null = null;
  #lastDroppedFlowReceiveTimeMs: number | null = null;
  #flowObservationStartTimeMs: number | null = null;

  constructor(config: LocalBookConfig, ports: LocalBookPorts) {
    this.#config = validateConfig(config);
    if (typeof ports?.clock?.nowMs !== 'function') throw new TypeError('local book requires an injected clock');
    if (ports.metricSink !== undefined && typeof ports.metricSink?.record !== 'function') {
      throw new TypeError('local book metric sink is invalid');
    }
    this.#clock = ports.clock;
    this.#metricSink = ports.metricSink ?? null;
    this.#now();
  }

  beginGeneration(connectionGeneration: number): Readonly<LocalBookResyncRequest> {
    integer(connectionGeneration, 'connectionGeneration', 1);
    const previousGeneration = this.#connectionGeneration;
    if (previousGeneration !== 0 && connectionGeneration <= previousGeneration) {
      throw new RangeError('connectionGeneration must advance monotonically');
    }
    if (this.#buffer.length > 0) this.#counters.droppedCount += this.#buffer.length;
    if (previousGeneration !== 0) this.#counters.resyncCount += 1;
    this.#connectionGeneration = connectionGeneration;
    this.#syncEpoch += 1;
    this.#clearOperationalState();
    this.#phase = 'BUFFERING';
    this.#pendingResyncRequest = this.#makeResyncRequest(
      previousGeneration === 0 ? 'INITIAL_BOOTSTRAP' : 'GENERATION_CHANGED',
      this.#now(),
      null,
      null,
    );
    return this.#pendingResyncRequest;
  }

  stop(): void {
    if (this.#buffer.length > 0) this.#counters.droppedCount += this.#buffer.length;
    this.#clearOperationalState();
    this.#phase = 'STOPPED';
    this.#pendingResyncRequest = null;
  }

  ingestDelta(event: DepthRuntimeEvent): Readonly<LocalBookOutcome> {
    if (this.#phase === 'STOPPED') {
      return outcome('REJECTED', false, this.#cursor, {
        failure: makeStableFailure('UNAVAILABLE', COMPONENT, 'local book must be started explicitly', 'phase'),
      });
    }
    if (!Number.isSafeInteger(event?.connectionGeneration) || event.connectionGeneration !== this.#connectionGeneration) {
      this.#counters.outOfOrderCount += 1;
      return outcome('OUT_OF_ORDER', false, this.#cursor, {
        ignoredEvents: 1,
        failure: makeStableFailure(
          'OUT_OF_ORDER_EVENT', COMPONENT, 'depth event belongs to a non-current connection generation',
          'connectionGeneration',
        ),
      });
    }
    const prepared = this.#prepareEvent(event, 'DEPTH_DELTA');
    if (!prepared.ok) {
      this.#counters.invalidCount += 1;
      const request = this.#requestResync('INVALID_DEPTH_EVENT', prepared.failure, this.#now(), 1);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure: prepared.failure, resyncRequest: request });
    }
    const candidate = prepared.value;
    if (this.#recentFingerprintSet.has(candidate.fingerprint)
      || this.#buffer.some((entry) => entry.fingerprint === candidate.fingerprint)) {
      this.#counters.duplicateCount += 1;
      return outcome('DUPLICATE', false, this.#cursor, { ignoredEvents: 1 });
    }
    if (this.#phase === 'BUFFERING') return this.#bufferEvent(candidate);
    if (this.#phase === 'WAITING_BRIDGE') return this.#bridgeAfterSnapshot(candidate);
    return this.#processLiveEvent(candidate);
  }

  applySnapshot(input: ApplyLocalBookSnapshotInput): Readonly<LocalBookOutcome> {
    if (this.#phase === 'STOPPED') {
      return outcome('REJECTED', false, this.#cursor, {
        failure: makeStableFailure('UNAVAILABLE', COMPONENT, 'local book must be started explicitly', 'phase'),
      });
    }
    if (this.#phase !== 'BUFFERING' || this.#pendingResyncRequest === null) {
      this.#counters.outOfOrderCount += 1;
      return outcome('OUT_OF_ORDER', false, this.#cursor, {
        ignoredEvents: 1,
        failure: makeStableFailure('OUT_OF_ORDER_EVENT', COMPONENT, 'no depth snapshot is currently requested', 'phase'),
      });
    }
    if (input.connectionGeneration !== this.#connectionGeneration || input.syncEpoch !== this.#syncEpoch
      || input.event?.connectionGeneration !== this.#connectionGeneration) {
      this.#counters.outOfOrderCount += 1;
      return outcome('OUT_OF_ORDER', false, this.#cursor, {
        ignoredEvents: 1,
        failure: makeStableFailure('OUT_OF_ORDER_EVENT', COMPONENT, 'snapshot token is obsolete', 'syncEpoch'),
      });
    }
    const prepared = this.#prepareEvent(input.event, 'DEPTH_SNAPSHOT');
    if (!prepared.ok) {
      this.#counters.invalidCount += 1;
      const request = this.#requestResync('INVALID_DEPTH_EVENT', prepared.failure, this.#now(), 1);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure: prepared.failure, resyncRequest: request });
    }
    const now = this.#now();
    if (now - prepared.value.event.receiveTimeMs > this.#config.maximumSnapshotApplyAgeMs) {
      const failure = makeStableFailure('STALE_SOURCE', COMPONENT, 'REST depth snapshot arrived too late to apply', 'receiveTimeMs');
      const request = this.#requestResync('STALE_SNAPSHOT', failure, now, 1);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure, resyncRequest: request });
    }
    const snapshot = prepared.value;
    const snapshotLast = snapshot.last;
    if (this.#config.productFamily === 'SPOT' && this.#buffer.length > 0
      && snapshotLast < this.#buffer[0].first) {
      const failure = makeStableFailure(
        'SEQUENCE_GAP', COMPONENT, 'Spot snapshot precedes the first buffered update range',
        'lastUpdateId', [snapshot.evidence.id, this.#buffer[0].evidence.id],
      );
      this.#counters.sequenceGapCount += 1;
      const request = this.#requestResync('SNAPSHOT_TOO_OLD', failure, now, 1);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure, resyncRequest: request });
    }
    const kept: PreparedDepthEvent[] = [];
    for (const buffered of this.#buffer) {
      const old = this.#config.productFamily === 'SPOT'
        ? buffered.last <= snapshotLast
        : buffered.last < snapshotLast;
      if (old) this.#counters.bootstrapDiscardedCount += 1;
      else kept.push(buffered);
    }
    if (kept.length > 0 && !(kept[0].first <= snapshotLast && snapshotLast <= kept[0].last)) {
      const failure = makeStableFailure(
        'SEQUENCE_GAP', COMPONENT, 'first buffered depth event does not bridge the REST snapshot',
        'sequence', [snapshot.evidence.id, kept[0].evidence.id],
      );
      this.#counters.sequenceGapCount += 1;
      const request = this.#requestResync('BOOTSTRAP_BRIDGE_MISSING', failure, now, 1);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure, resyncRequest: request });
    }
    this.#loadSnapshot(snapshot);
    this.#buffer.length = 0;
    this.#bufferedLevelUpdates = 0;
    this.#pendingResyncRequest = null;
    if (this.#bids.size === 0 || this.#asks.size === 0) {
      const failure = makeStableFailure('INCOMPLETE_EVIDENCE', COMPONENT, 'snapshot has an empty book side', null, [snapshot.evidence.id]);
      const request = this.#requestResync('EMPTY_BOOK_SIDE', failure, now, 0);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure, resyncRequest: request });
    }
    if (kept.length === 0) {
      this.#phase = 'WAITING_BRIDGE';
      return outcome('SNAPSHOT_ACCEPTED_WAITING_BRIDGE', true, this.#cursor);
    }
    const appliedBefore = this.#counters.appliedCount;
    const bridge = this.#applyEvent(kept[0], false);
    if (bridge.failure !== null && bridge.reason !== null) {
      const request = this.#requestResync(bridge.reason, bridge.failure, now, 0);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure: bridge.failure, resyncRequest: request });
    }
    this.#phase = 'LIVE';
    this.#flowObservationStartTimeMs = kept[0].event.receiveTimeMs;
    let ignored = 0;
    for (let index = 1; index < kept.length; index += 1) {
      const result = this.#processLiveEvent(kept[index]);
      if (result.kind === 'RESYNC_REQUIRED') return result;
      if (!result.accepted) ignored += result.ignoredEvents;
    }
    return outcome('BOOTSTRAPPED', true, this.#cursor, {
      appliedEvents: this.#counters.appliedCount - appliedBefore,
      ignoredEvents: ignored,
    });
  }

  snapshot(atMs = this.#now()): Readonly<LocalBookSnapshot> {
    integer(atMs, 'snapshot time');
    const latestKnowledgeTimeMs = this.#snapshotReceiveTimeMs === null && this.#lastDeltaReceiveTimeMs === null
      ? null
      : Math.max(this.#snapshotReceiveTimeMs ?? 0, this.#lastDeltaReceiveTimeMs ?? 0);
    if (latestKnowledgeTimeMs !== null && atMs < latestKnowledgeTimeMs) {
      throw new RangeError('snapshot time cannot precede current book knowledge');
    }
    const bids = this.#levels('BID');
    const asks = this.#levels('ASK');
    const metrics = calculateBookDepthMetrics(bids, asks, this.#config.depthBandsBps);
    const receiveAgeMs = this.#lastDeltaReceiveTimeMs === null ? null : Math.max(0, atMs - this.#lastDeltaReceiveTimeMs);
    const sourceReference = this.#lastDeltaSourceTransactionTimeMs ?? this.#lastDeltaSourceEventTimeMs;
    const sourceAgeMs = sourceReference === null ? null : Math.max(0, atMs - sourceReference);
    const processingLagMs = this.#lastDeltaReceiveTimeMs === null || this.#lastProcessedTimeMs === null
      ? null
      : Math.max(0, this.#lastProcessedTimeMs - this.#lastDeltaReceiveTimeMs);
    const knowledgeTimeMs = latestKnowledgeTimeMs;
    const freshnessState = this.#phase !== 'LIVE' || receiveAgeMs === null
      ? 'UNAVAILABLE' as const
      : receiveAgeMs >= this.#config.staleAfterMs
        || (sourceAgeMs !== null && sourceAgeMs >= this.#config.staleAfterMs)
        ? 'STALE' as const : 'FRESH' as const;
    const bothSidesPresent = bids.length > 0 && asks.length > 0;
    const sequenceComplete = this.#phase === 'LIVE';
    const reasons = [
      ...(!sequenceComplete ? ['SEQUENCE_NOT_READY'] : []),
      ...(!bothSidesPresent ? ['BOOK_SIDE_MISSING'] : []),
      ...(this.#retentionTruncated ? ['RETENTION_TRUNCATED'] : []),
    ].sort();
    const completeness: Readonly<LocalBookCompleteness> = Object.freeze({
      state: !bothSidesPresent ? 'MISSING' : sequenceComplete && !this.#retentionTruncated ? 'COMPLETE' : 'PARTIAL',
      sequenceComplete,
      bothSidesPresent,
      retentionTruncated: this.#retentionTruncated,
      maximumLevelsKnown: this.#maximumLevelsKnown,
      unknownBeyondSnapshot: this.#maximumLevelsKnown !== null,
      reasonCodes: Object.freeze(reasons),
    });
    const observedState = this.#phase === 'LIVE'
      ? freshnessState === 'STALE' ? 'STALE' : this.#retentionTruncated ? 'DEGRADED' : 'LIVE'
      : this.#phase;
    return Object.freeze({
      sourceId: this.#config.sourceId,
      snapshotSourceId: this.#config.snapshotSourceId,
      deltaSourceId: this.#config.deltaSourceId,
      productFamily: this.#config.productFamily,
      instrumentId: this.#config.instrumentId,
      symbol: this.#config.symbol,
      bookScope: this.#config.bookScope,
      phase: this.#phase,
      observedState,
      connectionGeneration: this.#connectionGeneration,
      syncEpoch: this.#syncEpoch,
      cursor: this.#cursor,
      snapshotSequence: cloneSequence(this.#snapshotSequence),
      bids,
      asks,
      bufferedEvents: this.#buffer.length,
      bufferedLevelUpdates: this.#bufferedLevelUpdates,
      freshnessState,
      staleAfterMs: this.#config.staleAfterMs,
      temporal: Object.freeze({
        snapshotReceiveTimeMs: this.#snapshotReceiveTimeMs,
        lastDeltaSourceEventTimeMs: this.#lastDeltaSourceEventTimeMs,
        lastDeltaSourceTransactionTimeMs: this.#lastDeltaSourceTransactionTimeMs,
        lastDeltaReceiveTimeMs: this.#lastDeltaReceiveTimeMs,
        lastProcessedTimeMs: this.#lastProcessedTimeMs,
        knowledgeTimeMs,
        receiveAgeMs,
        sourceAgeMs,
        processingLagMs,
      }),
      completeness,
      metrics,
      counters: Object.freeze({ ...this.#counters }),
      lastFailure: frozenFailure(this.#lastFailure),
      pendingResyncRequest: this.#pendingResyncRequest,
      latestCorrelationId: this.#latestCorrelationId,
      provenanceDigest: this.#provenanceDigest,
      snapshotTimeMs: atMs,
    });
  }

  depthMetrics(): Readonly<BookDepthMetrics> {
    return calculateBookDepthMetrics(this.#levels('BID'), this.#levels('ASK'), this.#config.depthBandsBps);
  }

  flowMetrics(windowMs: number, atMs = this.#now()): Readonly<BookFlowMetrics> {
    integer(windowMs, 'flow window', 1);
    integer(atMs, 'flow metric time');
    if (atMs > this.#now()) throw new RangeError('flow metric time cannot exceed the injected clock');
    const maximumWindow = this.#config.flowWindowsMs[this.#config.flowWindowsMs.length - 1];
    if (windowMs > maximumWindow) throw new RangeError('flow query exceeds retained history');
    const start = atMs - windowMs;
    const samples = this.#flowSamples.filter((sample) => sample.receiveTimeMs >= start && sample.receiveTimeMs <= atMs);
    const sum = (select: (sample: LocalBookFlowSample) => number | null): number | null => {
      const values = samples.map(select);
      return values.some((value) => value === null) ? null : finiteSum(values as number[]);
    };
    const addedBidQuote = sum((sample) => sample.addedBidQuote);
    const removedBidQuote = sum((sample) => sample.removedBidQuote);
    const addedAskQuote = sum((sample) => sample.addedAskQuote);
    const removedAskQuote = sum((sample) => sample.removedAskQuote);
    const addedQuote = addedBidQuote === null || addedAskQuote === null ? null : finiteSum([addedBidQuote, addedAskQuote]);
    const removedQuote = removedBidQuote === null || removedAskQuote === null ? null : finiteSum([removedBidQuote, removedAskQuote]);
    const netDepthChangeQuote = addedQuote === null || removedQuote === null ? null : addedQuote - removedQuote;
    const incompleteSamples = samples.some((sample) => !sample.complete);
    const additionRemovalRatio = addedQuote !== null && removedQuote !== null && removedQuote > 0
      ? addedQuote / removedQuote : null;
    const removalAdditionRatio = removedQuote !== null && addedQuote !== null && addedQuote > 0
      ? removedQuote / addedQuote : null;
    const ratioOverflow = (additionRemovalRatio !== null && !Number.isFinite(additionRemovalRatio))
      || (removalAdditionRatio !== null && !Number.isFinite(removalAdditionRatio));
    const overflow = !incompleteSamples
      && ([addedQuote, removedQuote, netDepthChangeQuote].some((value) => value === null) || ratioOverflow);
    const retentionIncomplete = this.#lastDroppedFlowReceiveTimeMs !== null && this.#lastDroppedFlowReceiveTimeMs >= start;
    const windowFullyObserved = this.#flowObservationStartTimeMs !== null
      && this.#flowObservationStartTimeMs <= start;
    const latestSample = samples.at(-1) ?? null;
    const latestSampleSourceTimeMs = latestSample?.sourceTransactionTimeMs
      ?? latestSample?.sourceEventTimeMs ?? null;
    const bookSynchronized = this.#phase === 'LIVE';
    const bookStale = latestSample !== null && (
      atMs - latestSample.receiveTimeMs >= this.#config.staleAfterMs
      || (latestSampleSourceTimeMs !== null
        && atMs - latestSampleSourceTimeMs >= this.#config.staleAfterMs)
    );
    const reasons = [...new Set([
      ...samples.flatMap((sample) => sample.reasonCodes),
      ...(samples.length === 0 ? ['NO_FLOW_SAMPLES'] : []),
      ...(!windowFullyObserved ? ['WINDOW_NOT_FULLY_OBSERVED'] : []),
      ...(!bookSynchronized ? ['BOOK_NOT_SYNCHRONIZED'] : []),
      ...(bookStale ? ['BOOK_STALE'] : []),
      ...(overflow ? ['NUMERIC_OVERFLOW'] : []),
      ...(retentionIncomplete ? ['FLOW_RETENTION_TRUNCATED'] : []),
      ...(removedQuote === 0 && addedQuote !== null && addedQuote > 0 ? ['NO_REMOVAL_DENOMINATOR'] : []),
      ...(addedQuote === 0 && removedQuote !== null && removedQuote > 0 ? ['NO_ADDITION_DENOMINATOR'] : []),
    ])].sort();
    return Object.freeze({
      windowMs,
      observationStartMs: samples[0]?.receiveTimeMs ?? null,
      observationEndMs: samples.at(-1)?.receiveTimeMs ?? null,
      sampleCount: samples.length,
      addedBidQuote,
      removedBidQuote,
      addedAskQuote,
      removedAskQuote,
      addedQuote,
      removedQuote,
      netDepthChangeQuote: netDepthChangeQuote !== null && Number.isFinite(netDepthChangeQuote) ? netDepthChangeQuote : null,
      grossAdditionRemovalRatio: additionRemovalRatio !== null && Number.isFinite(additionRemovalRatio)
        ? additionRemovalRatio : null,
      grossRemovalAdditionRatio: removalAdditionRatio !== null && Number.isFinite(removalAdditionRatio)
        ? removalAdditionRatio : null,
      complete: samples.length > 0 && windowFullyObserved
        && bookSynchronized && !bookStale
        && !incompleteSamples && !overflow && !retentionIncomplete,
      reasonCodes: Object.freeze(reasons),
    });
  }

  querySlippage(query: SlippageQuery, atMs = this.#now()): Readonly<SlippageResult> {
    // Validate the query even when the book is unavailable.
    calculateSlippage([], [], query);
    const snapshot = this.snapshot(atMs);
    if (snapshot.phase !== 'LIVE') return unavailableSlippageResult(query, 'UNAVAILABLE', 'BOOK_NOT_SYNCHRONIZED');
    if (snapshot.freshnessState === 'STALE') return unavailableSlippageResult(query, 'STALE', 'BOOK_STALE');
    return calculateSlippage(snapshot.bids, snapshot.asks, query);
  }

  emitMetrics(atMs = this.#now()): void {
    integer(atMs, 'metric emission time');
    if (atMs > this.#now()) throw new RangeError('metric emission time cannot exceed the injected clock');
    const snapshot = this.snapshot(atMs);
    this.#recordMetric('book_state', snapshot.observedState, 'state', atMs);
    this.#recordMetric('book_age_ms', snapshot.temporal.receiveAgeMs, 'ms', atMs);
    this.#recordMetric('book_sequence_complete', snapshot.completeness.sequenceComplete, 'boolean', atMs);
    this.#recordMetric('book_buffered_events', snapshot.bufferedEvents, 'events', atMs);
    this.#recordMetric('book_bid_levels', snapshot.bids.length, 'levels', atMs);
    this.#recordMetric('book_ask_levels', snapshot.asks.length, 'levels', atMs);
    this.#recordMetric('book_spread_bps', snapshot.metrics.spreadBps, 'basis_points', atMs);
    this.#recordMetric('book_resync_count', snapshot.counters.resyncCount, 'events', atMs);
    this.#recordMetric('book_sequence_gap_count', snapshot.counters.sequenceGapCount, 'events', atMs);
    for (const band of snapshot.metrics.bands) {
      this.#recordMetric(`book_depth_quote_${band.distanceBps}bps`, band.totalQuoteNotional, 'quote_asset', atMs);
      this.#recordMetric(`book_imbalance_${band.distanceBps}bps`, band.quoteImbalance, 'ratio', atMs);
      this.#recordMetric(`book_band_complete_${band.distanceBps}bps`,
        band.bidCoverageComplete && band.askCoverageComplete, 'boolean', atMs);
    }
    for (const windowMs of this.#config.flowWindowsMs) {
      const flow = this.flowMetrics(windowMs, atMs);
      this.#recordMetric(`book_added_quote_${windowMs}ms`, flow.addedQuote, 'quote_asset', atMs);
      this.#recordMetric(`book_removed_quote_${windowMs}ms`, flow.removedQuote, 'quote_asset', atMs);
      this.#recordMetric(`book_add_remove_ratio_${windowMs}ms`, flow.grossAdditionRemovalRatio, 'ratio', atMs);
    }
  }

  #prepareEvent(event: DepthRuntimeEvent, expectedKind: NormalizedDepth['kind']): PreparedResult {
    if (typeof event !== 'object' || event === null || Array.isArray(event)) {
      return { ok: false, failure: makeStableFailure('INVALID_VALUE', COMPONENT, 'runtime depth event is required', null) };
    }
    const expectedSourceId = expectedKind === 'DEPTH_SNAPSHOT' ? this.#config.snapshotSourceId : this.#config.deltaSourceId;
    const expectedEndpoint = expectedKind === 'DEPTH_SNAPSHOT' ? 'REST' : 'PUBLIC';
    if (event.sourceId !== expectedSourceId || event.endpointClass !== expectedEndpoint
      || event.productFamily !== this.#config.productFamily) {
      return { ok: false, failure: makeStableFailure('MISSING_SOURCE', COMPONENT, 'depth event source identity is inconsistent', 'sourceId') };
    }
    if (!Number.isSafeInteger(event.connectionGeneration) || event.connectionGeneration < 1
      || !Number.isSafeInteger(event.receiveTimeMs) || event.receiveTimeMs < 0
      || typeof event.correlationId !== 'string' || event.correlationId.length === 0 || event.correlationId.length > 256) {
      return { ok: false, failure: makeStableFailure('INVALID_VALUE', COMPONENT, 'depth event envelope is malformed', null) };
    }
    const validation = validateNormalizedEvidence(event.payload);
    if (!validation.ok) return { ok: false, failure: validation.failure };
    if (validation.value.kind !== expectedKind) {
      return { ok: false, failure: makeStableFailure('INVALID_VARIANT', COMPONENT, 'unexpected depth evidence kind', 'kind') };
    }
    const evidence = validation.value as NormalizedDepth;
    if (evidence.instrument.instrumentId !== this.#config.instrumentId
      || evidence.instrument.symbol !== this.#config.symbol
      || evidence.instrument.productFamily !== this.#config.productFamily
      || evidence.bookScope !== this.#config.bookScope) {
      return { ok: false, failure: makeStableFailure('INVALID_VALUE', COMPONENT, 'depth evidence targets another book', 'instrument') };
    }
    if (expectedKind === 'DEPTH_SNAPSHOT' && evidence.maximumLevelsKnown !== this.#config.snapshotLimit) {
      return { ok: false, failure: makeStableFailure('INVALID_VALUE', COMPONENT, 'snapshot depth limit does not match the resync request', 'maximumLevelsKnown') };
    }
    if (evidence.truth.completeness.state !== 'COMPLETE' || evidence.truth.freshness.state !== 'FRESH') {
      return { ok: false, failure: makeStableFailure('INCOMPLETE_EVIDENCE', COMPONENT, 'depth evidence must be fresh and structurally complete', 'truth') };
    }
    const temporal = evidence.truth.temporal;
    if (!sameSequence(event.sequence, temporal.sequence) || event.receiveTimeMs !== temporal.receivedTimeMs
      || event.sourceEventTimeMs !== temporal.sourceEventTimeMs
      || event.sourceTransactionTimeMs !== temporal.sourceTransactionTimeMs) {
      return { ok: false, failure: makeStableFailure('INVALID_VALUE', COMPONENT, 'runtime envelope does not match normalized depth truth', 'temporal') };
    }
    const now = this.#now();
    const authoritativeTimeMs = event.sourceTransactionTimeMs ?? event.sourceEventTimeMs ?? event.receiveTimeMs;
    if (event.receiveTimeMs > now + this.#config.maximumFutureSkewMs
      || authoritativeTimeMs > now + this.#config.maximumFutureSkewMs
      || now - event.receiveTimeMs > this.#config.staleAfterMs
      || now - authoritativeTimeMs > this.#config.staleAfterMs) {
      return { ok: false, failure: makeStableFailure('STALE_SOURCE', COMPONENT, 'depth event receive time is outside the accepted window', 'receiveTimeMs') };
    }
    const sequence = temporal.sequence as RuntimeSequence;
    const boundedSequenceId = (value: string | null): boolean => value === null || /^\d{1,32}$/.test(value);
    if (!boundedSequenceId(sequence.first) || !boundedSequenceId(sequence.last)
      || !boundedSequenceId(sequence.previous) || evidence.id.length > 256) {
      return { ok: false, failure: makeStableFailure('INVALID_VALUE', COMPONENT, 'depth identifiers exceed the local safety bound', 'sequence') };
    }
    let first: bigint;
    let last: bigint;
    let previous: bigint | null;
    try {
      first = BigInt(sequence.first);
      last = BigInt(sequence.last);
      previous = sequence.previous === null ? null : BigInt(sequence.previous);
    } catch {
      return { ok: false, failure: makeStableFailure('INVALID_VALUE', COMPONENT, 'depth sequence is not a decimal integer range', 'sequence') };
    }
    if (first > last || (this.#config.productFamily === 'SPOT' && expectedKind === 'DEPTH_DELTA' && previous !== null)
      || (this.#config.productFamily === 'USD_M_PERPETUAL' && expectedKind === 'DEPTH_DELTA' && previous === null)) {
      return { ok: false, failure: makeStableFailure('INVALID_VALUE', COMPONENT, 'depth sequence semantics do not match the product', 'sequence') };
    }
    const levelUpdates = evidence.bids.length + evidence.asks.length;
    if (levelUpdates > this.#config.maximumBufferedLevelUpdates) {
      return { ok: false, failure: makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'one depth record exceeds the level-update bound', 'levels') };
    }
    return {
      ok: true,
      value: {
        event: Object.freeze({ ...event, sequence: cloneSequence(event.sequence), payload: evidence }),
        evidence,
        sequence,
        first,
        last,
        previous,
        fingerprint: evidence.id,
        levelUpdates,
      },
    };
  }

  #bufferEvent(prepared: PreparedDepthEvent): Readonly<LocalBookOutcome> {
    if (this.#buffer.length + 1 > this.#config.maximumBufferedEvents) {
      this.#counters.droppedCount += 1;
      const failure = makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'pre-snapshot depth event capacity exceeded', 'maximumBufferedEvents');
      const request = this.#requestResync('BUFFER_EVENT_CAPACITY', failure, this.#now(), 0);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure, resyncRequest: request });
    }
    if (this.#bufferedLevelUpdates + prepared.levelUpdates > this.#config.maximumBufferedLevelUpdates) {
      this.#counters.droppedCount += 1;
      const failure = makeStableFailure('BUDGET_EXHAUSTED', COMPONENT, 'pre-snapshot depth row capacity exceeded', 'maximumBufferedLevelUpdates');
      const request = this.#requestResync('BUFFER_UPDATE_CAPACITY', failure, this.#now(), 0);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure, resyncRequest: request });
    }
    this.#buffer.push(prepared);
    this.#bufferedLevelUpdates += prepared.levelUpdates;
    this.#counters.bufferedCount += 1;
    return outcome('BUFFERED', true, this.#cursor);
  }

  #bridgeAfterSnapshot(prepared: PreparedDepthEvent): Readonly<LocalBookOutcome> {
    const cursor = BigInt(this.#cursor as string);
    const old = this.#config.productFamily === 'SPOT' ? prepared.last <= cursor : prepared.last < cursor;
    if (old) {
      this.#counters.bootstrapDiscardedCount += 1;
      return outcome('OUT_OF_ORDER', false, this.#cursor, { ignoredEvents: 1 });
    }
    const bridges = this.#config.productFamily === 'SPOT'
      ? prepared.first <= cursor + 1n && prepared.last > cursor
      : (prepared.first <= cursor && cursor <= prepared.last)
        || (prepared.last > cursor && prepared.previous === cursor);
    if (!bridges) {
      this.#counters.sequenceGapCount += 1;
      const failure = makeStableFailure('SEQUENCE_GAP', COMPONENT, 'depth event does not bridge the accepted snapshot', 'sequence');
      const request = this.#requestResync('BOOTSTRAP_BRIDGE_MISSING', failure, this.#now(), 1);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure, resyncRequest: request });
    }
    const overlapsSnapshot = prepared.first <= cursor && cursor <= prepared.last;
    const recordFlow = !overlapsSnapshot;
    const applied = this.#applyEvent(prepared, recordFlow);
    if (applied.failure !== null && applied.reason !== null) {
      const request = this.#requestResync(applied.reason, applied.failure, this.#now(), 0);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure: applied.failure, resyncRequest: request });
    }
    this.#phase = 'LIVE';
    this.#flowObservationStartTimeMs = recordFlow
      ? this.#snapshotReceiveTimeMs
      : prepared.event.receiveTimeMs;
    return outcome('BOOTSTRAPPED', true, this.#cursor, { appliedEvents: 1 });
  }

  #processLiveEvent(prepared: PreparedDepthEvent): Readonly<LocalBookOutcome> {
    if (this.#recentFingerprintSet.has(prepared.fingerprint)) {
      this.#counters.duplicateCount += 1;
      return outcome('DUPLICATE', false, this.#cursor, { ignoredEvents: 1 });
    }
    const cursor = BigInt(this.#cursor as string);
    if (prepared.last < cursor) {
      this.#counters.outOfOrderCount += 1;
      return outcome('OUT_OF_ORDER', false, this.#cursor, {
        ignoredEvents: 1,
        failure: makeStableFailure('OUT_OF_ORDER_EVENT', COMPONENT, 'depth event ends before the accepted cursor', 'sequence.last'),
      });
    }
    if (prepared.last === cursor) {
      this.#counters.sequenceGapCount += 1;
      const failure = makeStableFailure('OUT_OF_ORDER_EVENT', COMPONENT, 'update ID was reused with different depth content', 'sequence.last');
      const request = this.#requestResync('CONFLICTING_SEQUENCE_REUSE', failure, this.#now(), 1);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure, resyncRequest: request });
    }
    if (this.#lastDeltaReceiveTimeMs !== null && prepared.event.receiveTimeMs < this.#lastDeltaReceiveTimeMs) {
      this.#counters.outOfOrderCount += 1;
      const failure = makeStableFailure('OUT_OF_ORDER_EVENT', COMPONENT, 'advancing depth event has a regressing receive time', 'receiveTimeMs');
      const request = this.#requestResync('INVALID_DEPTH_EVENT', failure, this.#now(), 1);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure, resyncRequest: request });
    }
    const next = cursor + 1n;
    if (this.#config.productFamily === 'SPOT') {
      if (prepared.first > next) {
        this.#counters.sequenceGapCount += 1;
        const failure = makeStableFailure('SEQUENCE_GAP', COMPONENT, 'Spot depth range begins after the next expected update', 'sequence.first');
        const request = this.#requestResync('SEQUENCE_GAP', failure, this.#now(), 1);
        return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure, resyncRequest: request });
      }
    } else {
      if (prepared.previous !== cursor) {
        this.#counters.sequenceGapCount += 1;
        const failure = makeStableFailure('SEQUENCE_GAP', COMPONENT, 'USD-M pu does not equal the previously applied u', 'sequence.previous');
        const request = this.#requestResync('PREDECESSOR_MISMATCH', failure, this.#now(), 1);
        return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure, resyncRequest: request });
      }
    }
    const applied = this.#applyEvent(prepared, true);
    if (applied.failure !== null && applied.reason !== null) {
      const request = this.#requestResync(applied.reason, applied.failure, this.#now(), 0);
      return outcome('RESYNC_REQUIRED', false, this.#cursor, { failure: applied.failure, resyncRequest: request });
    }
    return outcome('APPLIED', true, this.#cursor, { appliedEvents: 1 });
  }

  #loadSnapshot(snapshot: PreparedDepthEvent): void {
    this.#bids.clear();
    this.#asks.clear();
    for (const level of snapshot.evidence.bids) this.#bids.set(level.price, level.baseQuantity);
    for (const level of snapshot.evidence.asks) this.#asks.set(level.price, level.baseQuantity);
    this.#retentionTruncated = false;
    this.#trimSide(this.#bids, 'BID');
    this.#trimSide(this.#asks, 'ASK');
    this.#cursor = snapshot.sequence.last;
    this.#snapshotSequence = cloneSequence(snapshot.sequence);
    this.#snapshotReceiveTimeMs = snapshot.event.receiveTimeMs;
    this.#lastDeltaSourceEventTimeMs = null;
    this.#lastDeltaSourceTransactionTimeMs = null;
    this.#lastDeltaReceiveTimeMs = null;
    this.#lastProcessedTimeMs = this.#now();
    this.#maximumLevelsKnown = snapshot.evidence.maximumLevelsKnown;
    this.#lastFailure = null;
    this.#latestCorrelationId = snapshot.event.correlationId;
    this.#provenanceDigest = stableId('local-book-chain', { evidenceId: snapshot.evidence.id });
    this.#recentFingerprints.length = 0;
    this.#recentFingerprintSet.clear();
    this.#flowSamples.length = 0;
    this.#lastDroppedFlowReceiveTimeMs = null;
    this.#flowObservationStartTimeMs = null;
  }

  #applyEvent(prepared: PreparedDepthEvent, recordFlow: boolean): ApplyResult {
    const preMetrics = calculateBookDepthMetrics(this.#levels('BID'), this.#levels('ASK'), this.#config.depthBandsBps);
    const flow = recordFlow ? this.#flowFor(prepared, preMetrics) : null;
    if (recordFlow && flow === null) {
      return {
        failure: makeStableFailure('INVALID_VALUE', COMPONENT, 'depth level change overflowed flow accounting', 'levels', [prepared.evidence.id]),
        reason: 'INVALID_DEPTH_EVENT',
      };
    }
    for (const level of prepared.evidence.bids) {
      if (level.baseQuantity === 0) this.#bids.delete(level.price);
      else this.#bids.set(level.price, level.baseQuantity);
    }
    for (const level of prepared.evidence.asks) {
      if (level.baseQuantity === 0) this.#asks.delete(level.price);
      else this.#asks.set(level.price, level.baseQuantity);
    }
    this.#trimSide(this.#bids, 'BID');
    this.#trimSide(this.#asks, 'ASK');
    const bids = this.#levels('BID');
    const asks = this.#levels('ASK');
    if (bids.length === 0 || asks.length === 0) {
      return {
        failure: makeStableFailure('INCOMPLETE_EVIDENCE', COMPONENT, 'depth update left an empty book side', null, [prepared.evidence.id]),
        reason: 'EMPTY_BOOK_SIDE',
      };
    }
    if (bids[0].price >= asks[0].price) {
      this.#counters.crossedCount += 1;
      return {
        failure: makeStableFailure('CROSSED_BOOK', COMPONENT, 'depth update crossed or locked the local book', null, [prepared.evidence.id]),
        reason: 'CROSSED_BOOK',
      };
    }
    this.#cursor = prepared.sequence.last;
    this.#lastDeltaSourceEventTimeMs = prepared.event.sourceEventTimeMs;
    this.#lastDeltaSourceTransactionTimeMs = prepared.event.sourceTransactionTimeMs;
    this.#lastDeltaReceiveTimeMs = prepared.event.receiveTimeMs;
    this.#lastProcessedTimeMs = this.#now();
    this.#latestCorrelationId = prepared.event.correlationId;
    this.#provenanceDigest = stableId('local-book-chain', {
      previous: this.#provenanceDigest,
      evidenceId: prepared.evidence.id,
      sequence: prepared.sequence,
    });
    this.#recordFingerprint(prepared.fingerprint);
    this.#counters.appliedCount += 1;
    this.#lastFailure = null;
    if (flow !== null) this.#pushFlow(flow);
    return { failure: null, reason: null };
  }

  #flowFor(prepared: PreparedDepthEvent, preMetrics: Readonly<BookDepthMetrics>): LocalBookFlowSample | null {
    let addedBidQuote = 0;
    let removedBidQuote = 0;
    let addedAskQuote = 0;
    let removedAskQuote = 0;
    const maximumBand = this.#config.depthBandsBps[this.#config.depthBandsBps.length - 1];
    const mid = preMetrics.midpoint;
    const band = preMetrics.bands.find((entry) => entry.distanceBps === maximumBand);
    const bidThreshold = mid === null ? -Infinity : mid * (1 - maximumBand / 10_000);
    const askThreshold = mid === null ? Infinity : mid * (1 + maximumBand / 10_000);
    let bidPriorUnknown = false;
    let askPriorUnknown = false;
    const account = (level: DepthLevel, previous: number, side: 'BID' | 'ASK'): boolean => {
      const inBand = side === 'BID' ? level.price >= bidThreshold : level.price <= askThreshold;
      if (!inBand) return true;
      const known = side === 'BID' ? this.#bids.has(level.price) : this.#asks.has(level.price);
      const coverageComplete = band !== undefined
        && (side === 'BID' ? band.bidCoverageComplete : band.askCoverageComplete);
      if (!known && !coverageComplete) {
        if (side === 'BID') bidPriorUnknown = true;
        else askPriorUnknown = true;
        return true;
      }
      const delta = level.baseQuantity - previous;
      const notional = level.price * Math.abs(delta);
      if (!Number.isFinite(notional)) return false;
      if (side === 'BID' && delta > 0) addedBidQuote += notional;
      else if (side === 'BID' && delta < 0) removedBidQuote += notional;
      else if (side === 'ASK' && delta > 0) addedAskQuote += notional;
      else if (side === 'ASK' && delta < 0) removedAskQuote += notional;
      return [addedBidQuote, removedBidQuote, addedAskQuote, removedAskQuote].every(Number.isFinite);
    };
    for (const level of prepared.evidence.bids) {
      if (!account(level, this.#bids.get(level.price) ?? 0, 'BID')) return null;
    }
    for (const level of prepared.evidence.asks) {
      if (!account(level, this.#asks.get(level.price) ?? 0, 'ASK')) return null;
    }
    return Object.freeze({
      receiveTimeMs: prepared.event.receiveTimeMs,
      sourceEventTimeMs: prepared.event.sourceEventTimeMs,
      sourceTransactionTimeMs: prepared.event.sourceTransactionTimeMs,
      addedBidQuote: bidPriorUnknown ? null : addedBidQuote,
      removedBidQuote: bidPriorUnknown ? null : removedBidQuote,
      addedAskQuote: askPriorUnknown ? null : addedAskQuote,
      removedAskQuote: askPriorUnknown ? null : removedAskQuote,
      complete: !bidPriorUnknown && !askPriorUnknown,
      reasonCodes: Object.freeze([
        ...(bidPriorUnknown ? ['BID_PRIOR_DEPTH_UNKNOWN'] : []),
        ...(askPriorUnknown ? ['ASK_PRIOR_DEPTH_UNKNOWN'] : []),
      ]),
    });
  }

  #trimSide(levels: Map<number, number>, side: 'BID' | 'ASK'): void {
    if (levels.size <= this.#config.maximumLevelsPerSide) return;
    const prices = [...levels.keys()].sort((left, right) => side === 'BID' ? right - left : left - right);
    const remove = prices.slice(this.#config.maximumLevelsPerSide);
    for (const price of remove) levels.delete(price);
    this.#retentionTruncated = true;
    this.#counters.prunedLevelCount += remove.length;
  }

  #levels(side: 'BID' | 'ASK'): readonly DepthLevel[] {
    const source = side === 'BID' ? this.#bids : this.#asks;
    const prices = [...source.keys()].sort((left, right) => side === 'BID' ? right - left : left - right);
    return Object.freeze(prices.map((price) => Object.freeze({ price, baseQuantity: source.get(price) as number })));
  }

  #recordFingerprint(fingerprint: string): void {
    if (this.#recentFingerprintSet.has(fingerprint)) return;
    this.#recentFingerprints.push(fingerprint);
    this.#recentFingerprintSet.add(fingerprint);
    if (this.#recentFingerprints.length > this.#config.maximumRecentFingerprints) {
      const removed = this.#recentFingerprints.shift();
      if (removed !== undefined) this.#recentFingerprintSet.delete(removed);
    }
  }

  #pushFlow(sample: LocalBookFlowSample): void {
    this.#flowSamples.push(sample);
    if (this.#flowSamples.length > this.#config.maximumFlowSamples) {
      const removed = this.#flowSamples.shift();
      if (removed !== undefined) this.#markDroppedFlow(removed.receiveTimeMs);
      this.#counters.flowDroppedCount += 1;
    }
    this.#pruneFlowSamples(this.#now());
  }

  #pruneFlowSamples(atMs: number): void {
    const maximumWindow = this.#config.flowWindowsMs[this.#config.flowWindowsMs.length - 1];
    let remove = 0;
    while (remove < this.#flowSamples.length && atMs - this.#flowSamples[remove].receiveTimeMs > maximumWindow) {
      remove += 1;
    }
    if (remove > 0) {
      this.#markDroppedFlow(this.#flowSamples[remove - 1].receiveTimeMs);
      this.#flowSamples.splice(0, remove);
      this.#counters.flowDroppedCount += remove;
    }
  }

  #markDroppedFlow(receiveTimeMs: number): void {
    this.#lastDroppedFlowReceiveTimeMs = this.#lastDroppedFlowReceiveTimeMs === null
      ? receiveTimeMs
      : Math.max(this.#lastDroppedFlowReceiveTimeMs, receiveTimeMs);
  }

  #requestResync(
    reason: LocalBookResyncReason,
    failure: StableFailure,
    atMs: number,
    droppedCurrent: number,
  ): Readonly<LocalBookResyncRequest> {
    const firstBufferedSequence = cloneSequence(this.#buffer[0]?.sequence ?? null);
    const lastUpdateId = this.#cursor;
    this.#counters.resyncCount += 1;
    this.#counters.droppedCount += this.#buffer.length + droppedCurrent;
    this.#syncEpoch += 1;
    this.#clearOperationalState();
    this.#phase = 'BUFFERING';
    this.#lastFailure = failure;
    this.#pendingResyncRequest = this.#makeResyncRequest(reason, atMs, lastUpdateId, firstBufferedSequence);
    return this.#pendingResyncRequest;
  }

  #makeResyncRequest(
    reason: LocalBookResyncReason,
    requestedAtMs: number,
    lastUpdateId: string | null,
    firstBufferedSequence: RuntimeSequence | null,
  ): Readonly<LocalBookResyncRequest> {
    return Object.freeze({
      id: stableId('local-book-resync', {
        sourceId: this.#config.sourceId,
        connectionGeneration: this.#connectionGeneration,
        syncEpoch: this.#syncEpoch,
        reason,
        requestedAtMs,
        lastUpdateId,
        firstBufferedSequence,
      }),
      action: 'FETCH_PUBLIC_DEPTH_SNAPSHOT',
      reason,
      sourceId: this.#config.sourceId,
      snapshotSourceId: this.#config.snapshotSourceId,
      productFamily: this.#config.productFamily,
      symbol: this.#config.symbol,
      bookScope: this.#config.bookScope,
      connectionGeneration: this.#connectionGeneration,
      syncEpoch: this.#syncEpoch,
      requestedAtMs,
      snapshotLimit: this.#config.snapshotLimit,
      lastUpdateId,
      firstBufferedSequence,
    });
  }

  #clearOperationalState(): void {
    this.#bids.clear();
    this.#asks.clear();
    this.#buffer.length = 0;
    this.#bufferedLevelUpdates = 0;
    this.#recentFingerprints.length = 0;
    this.#recentFingerprintSet.clear();
    this.#flowSamples.length = 0;
    this.#cursor = null;
    this.#snapshotSequence = null;
    this.#snapshotReceiveTimeMs = null;
    this.#lastDeltaSourceEventTimeMs = null;
    this.#lastDeltaSourceTransactionTimeMs = null;
    this.#lastDeltaReceiveTimeMs = null;
    this.#lastProcessedTimeMs = null;
    this.#maximumLevelsKnown = null;
    this.#retentionTruncated = false;
    this.#lastFailure = null;
    this.#latestCorrelationId = null;
    this.#provenanceDigest = null;
    this.#lastDroppedFlowReceiveTimeMs = null;
    this.#flowObservationStartTimeMs = null;
  }

  #recordMetric(name: string, value: RuntimeMetric['value'], unit: string, observedAtMs: number): void {
    const metricSink = this.#metricSink;
    if (metricSink === null) return;
    try {
      metricSink.record({ sourceId: this.#config.sourceId, name, value, unit, observedAtMs });
    } catch {
      this.#counters.metricSinkFailureCount += 1;
    }
  }

  #now(): number {
    return integer(this.#clock.nowMs(), 'clock.nowMs');
  }
}

export function serializeLocalBookSnapshot(snapshot: LocalBookSnapshot): string {
  return canonicalJson(snapshot);
}
