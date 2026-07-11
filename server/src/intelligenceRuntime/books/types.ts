import type {
  BookScope,
  DepthLevel,
  NormalizedDepth,
  StableFailure,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  RuntimeClock,
  RuntimeMetricSink,
  RuntimeSequence,
  RuntimeSourceEvent,
} from '../contracts/index.js';

export type LocalBookProductFamily = 'SPOT' | 'USD_M_PERPETUAL';
export type LocalBookPhase = 'STOPPED' | 'BUFFERING' | 'WAITING_BRIDGE' | 'LIVE';
export type LocalBookObservedState = LocalBookPhase | 'DEGRADED' | 'STALE';

export type LocalBookResyncReason =
  | 'INITIAL_BOOTSTRAP'
  | 'GENERATION_CHANGED'
  | 'SNAPSHOT_TOO_OLD'
  | 'BOOTSTRAP_BRIDGE_MISSING'
  | 'SEQUENCE_GAP'
  | 'PREDECESSOR_MISMATCH'
  | 'CONFLICTING_SEQUENCE_REUSE'
  | 'BUFFER_EVENT_CAPACITY'
  | 'BUFFER_UPDATE_CAPACITY'
  | 'CROSSED_BOOK'
  | 'EMPTY_BOOK_SIDE'
  | 'INVALID_DEPTH_EVENT'
  | 'STALE_SNAPSHOT';

export interface LocalBookConfig {
  sourceId: string;
  snapshotSourceId: string;
  deltaSourceId: string;
  productFamily: LocalBookProductFamily;
  instrumentId: string;
  symbol: string;
  bookScope: BookScope;
  snapshotLimit: number;
  maximumLevelsPerSide: number;
  maximumBufferedEvents: number;
  maximumBufferedLevelUpdates: number;
  maximumRecentFingerprints: number;
  maximumFlowSamples: number;
  staleAfterMs: number;
  maximumSnapshotApplyAgeMs: number;
  maximumFutureSkewMs: number;
  depthBandsBps: readonly number[];
  flowWindowsMs: readonly number[];
}

export interface LocalBookPorts {
  clock: RuntimeClock;
  metricSink?: RuntimeMetricSink;
}

export type DepthRuntimeEvent = RuntimeSourceEvent<NormalizedDepth>;

export interface ApplyLocalBookSnapshotInput {
  connectionGeneration: number;
  syncEpoch: number;
  event: DepthRuntimeEvent;
}

export interface LocalBookResyncRequest {
  id: string;
  action: 'FETCH_PUBLIC_DEPTH_SNAPSHOT';
  reason: LocalBookResyncReason;
  sourceId: string;
  snapshotSourceId: string;
  productFamily: LocalBookProductFamily;
  symbol: string;
  bookScope: BookScope;
  connectionGeneration: number;
  syncEpoch: number;
  requestedAtMs: number;
  snapshotLimit: number;
  lastUpdateId: string | null;
  firstBufferedSequence: RuntimeSequence | null;
}

export type LocalBookOutcomeKind =
  | 'BUFFERED'
  | 'SNAPSHOT_ACCEPTED_WAITING_BRIDGE'
  | 'BOOTSTRAPPED'
  | 'APPLIED'
  | 'DUPLICATE'
  | 'OUT_OF_ORDER'
  | 'RESYNC_REQUIRED'
  | 'REJECTED';

export interface LocalBookOutcome {
  kind: LocalBookOutcomeKind;
  accepted: boolean;
  appliedEvents: number;
  ignoredEvents: number;
  cursor: string | null;
  failure: StableFailure | null;
  resyncRequest: LocalBookResyncRequest | null;
}

export interface LocalBookCounters {
  bufferedCount: number;
  appliedCount: number;
  duplicateCount: number;
  outOfOrderCount: number;
  sequenceGapCount: number;
  invalidCount: number;
  crossedCount: number;
  resyncCount: number;
  droppedCount: number;
  prunedLevelCount: number;
  bootstrapDiscardedCount: number;
  flowDroppedCount: number;
  metricSinkFailureCount: number;
}

export interface LocalBookTemporalState {
  snapshotReceiveTimeMs: number | null;
  lastDeltaSourceEventTimeMs: number | null;
  lastDeltaSourceTransactionTimeMs: number | null;
  lastDeltaReceiveTimeMs: number | null;
  lastProcessedTimeMs: number | null;
  knowledgeTimeMs: number | null;
  receiveAgeMs: number | null;
  sourceAgeMs: number | null;
  processingLagMs: number | null;
}

export interface LocalBookCompleteness {
  state: 'COMPLETE' | 'PARTIAL' | 'MISSING';
  sequenceComplete: boolean;
  bothSidesPresent: boolean;
  retentionTruncated: boolean;
  maximumLevelsKnown: number | null;
  unknownBeyondSnapshot: boolean;
  reasonCodes: readonly string[];
}

export interface DepthBandMetrics {
  distanceBps: number;
  bidBaseQuantity: number | null;
  askBaseQuantity: number | null;
  bidQuoteNotional: number | null;
  askQuoteNotional: number | null;
  totalQuoteNotional: number | null;
  quoteImbalance: number | null;
  bidCoverageComplete: boolean;
  askCoverageComplete: boolean;
}

export interface BookDepthMetrics {
  bestBidPrice: number | null;
  bestBidQuantity: number | null;
  bestAskPrice: number | null;
  bestAskQuantity: number | null;
  midpoint: number | null;
  spreadQuote: number | null;
  spreadBps: number | null;
  bidSlopeBpsPerLevel: number | null;
  askSlopeBpsPerLevel: number | null;
  symmetricSlopeBpsPerLevel: number | null;
  bands: readonly DepthBandMetrics[];
}

export interface BookFlowMetrics {
  windowMs: number;
  observationStartMs: number | null;
  observationEndMs: number | null;
  sampleCount: number;
  addedBidQuote: number | null;
  removedBidQuote: number | null;
  addedAskQuote: number | null;
  removedAskQuote: number | null;
  addedQuote: number | null;
  removedQuote: number | null;
  netDepthChangeQuote: number | null;
  grossAdditionRemovalRatio: number | null;
  grossRemovalAdditionRatio: number | null;
  complete: boolean;
  reasonCodes: readonly string[];
}

export type SlippageSize =
  | { unit: 'BASE'; value: number }
  | { unit: 'QUOTE'; value: number };

export interface SlippageQuery {
  side: 'BUY' | 'SELL';
  size: SlippageSize;
}

export interface SlippageResult {
  state: 'COMPLETE' | 'INSUFFICIENT_VISIBLE_DEPTH' | 'UNAVAILABLE' | 'STALE';
  side: 'BUY' | 'SELL';
  requestedUnit: SlippageSize['unit'];
  requestedValue: number;
  filledBaseQuantity: number;
  filledQuoteNotional: number;
  unfilledValue: number;
  touchPrice: number | null;
  worstPrice: number | null;
  averageFillPrice: number | null;
  slippageBpsAtRequestedSize: number | null;
  visibleFillAveragePrice: number | null;
  visibleFillSlippageBps: number | null;
  levelsConsumed: number;
  reasonCodes: readonly string[];
}

export interface LocalBookSnapshot {
  sourceId: string;
  snapshotSourceId: string;
  deltaSourceId: string;
  productFamily: LocalBookProductFamily;
  instrumentId: string;
  symbol: string;
  bookScope: BookScope;
  phase: LocalBookPhase;
  observedState: LocalBookObservedState;
  connectionGeneration: number;
  syncEpoch: number;
  cursor: string | null;
  snapshotSequence: RuntimeSequence | null;
  bids: readonly DepthLevel[];
  asks: readonly DepthLevel[];
  bufferedEvents: number;
  bufferedLevelUpdates: number;
  freshnessState: 'FRESH' | 'STALE' | 'UNAVAILABLE';
  staleAfterMs: number;
  temporal: Readonly<LocalBookTemporalState>;
  completeness: Readonly<LocalBookCompleteness>;
  metrics: Readonly<BookDepthMetrics>;
  counters: Readonly<LocalBookCounters>;
  lastFailure: StableFailure | null;
  pendingResyncRequest: LocalBookResyncRequest | null;
  latestCorrelationId: string | null;
  provenanceDigest: string | null;
  snapshotTimeMs: number;
}

export interface LocalBookFlowSample {
  receiveTimeMs: number;
  sourceEventTimeMs: number | null;
  sourceTransactionTimeMs: number | null;
  addedBidQuote: number | null;
  removedBidQuote: number | null;
  addedAskQuote: number | null;
  removedAskQuote: number | null;
  complete: boolean;
  reasonCodes: readonly string[];
}
