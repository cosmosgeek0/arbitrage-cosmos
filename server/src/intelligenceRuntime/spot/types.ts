import type {
  InstrumentIdentity,
  NormalizedBookTicker,
  NormalizedTrade,
  StableFailure,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  RuntimeLifecycleState,
  RuntimeSourceEvent,
  RuntimeSourceSnapshot,
} from '../contracts/index.js';

export const SPOT_BUFFERED_KINDS = Object.freeze([
  'MINI_TICKER',
  'BOOK_TICKER',
  'AGG_TRADE',
] as const);

export type SpotBufferedKind = (typeof SPOT_BUFFERED_KINDS)[number];
export type SpotFreshnessState = 'UNSEEN' | 'FRESH' | 'STALE';

/**
 * Runtime-local observation for Binance's changed-only 24-hour mini-ticker
 * stream. It is deliberately not a trade or a short-window volume sample.
 */
export interface SpotRolling24hObservation {
  id: string;
  kind: 'SPOT_ROLLING_24H_TICKER';
  instrument: InstrumentIdentity;
  sourceId: 'binance-spot-market-stream';
  dataset: 'spot.rolling_24h_mini_ticker';
  window: 'ROLLING_24H';
  lastPrice: number;
  openPrice24h: number;
  highPrice24h: number;
  lowPrice24h: number;
  baseVolume24h: number;
  quoteVolume24h: number;
  priceChange24hPercent: number;
  sourceEventTimeMs: number;
  sourceTransactionTimeMs: null;
  receiveTimeMs: number;
  connectionGeneration: number;
  correlationId: string;
}

export interface SpotReducerPolicy {
  configurationVersion: string;
  maximumSymbols: number;
  maximumFrameRecords: number;
  maximumRecentTradesPerSymbol: number;
  maximumFutureSkewMs: number;
  tickerMaximumAgeMs: number;
  bookMaximumAgeMs: number;
  tradeMaximumAgeMs: number;
  sourceSilentAfterMs: number;
  sourceStaleAfterMs: number;
  sourceGapAfterMs: number;
  bookSourceSilentAfterMs: number;
  bookSourceStaleAfterMs: number;
  tradeSourceSilentAfterMs: number;
  tradeSourceStaleAfterMs: number;
  inboundCapacity: number;
  maximumBufferedPayloadBytes: number;
}

export interface SpotSourceMetrics {
  generation: number;
  reconnectCount: number;
  frameCount: number;
  acceptedFrameCount: number;
  partialFrameCount: number;
  rejectedFrameCount: number;
  tickerObservationCount: number;
  bookObservationCount: number;
  tradeObservationCount: number;
  invalidCount: number;
  unknownSymbolCount: number;
  duplicateCount: number;
  outOfOrderCount: number;
  sequenceGapCount: number;
  staleInputCount: number;
  oldGenerationCount: number;
  sourceGapCount: number;
  sourceGapDurationMs: number;
  frameOverflowDropCount: number;
}

export interface SpotBackpressureSnapshot {
  capacity: number;
  maximumPayloadBytes: number;
  depth: number;
  acceptedCount: number;
  coalescedCount: number;
  droppedCount: number;
  capacityDropCount: number;
  oversizeDropCount: number;
  invalidPayloadDropCount: number;
  outOfOrderReplacementDropCount: number;
  oldGenerationDropCount: number;
  miniTickerFrameDropCount: number;
  replaceableKinds: readonly ['BOOK_TICKER'];
  nonReplaceableKinds: readonly ['MINI_TICKER', 'AGG_TRADE'];
  overflowPolicy: 'DROP_NEW_AND_COUNT';
}

interface SpotBufferedMessageBase {
  generation: number;
  receiveTimeMs: number;
  payload: unknown;
  correlationId?: string;
}

export interface SpotBufferedMiniTickerFrame extends SpotBufferedMessageBase {
  kind: 'MINI_TICKER';
}

export interface SpotBufferedSymbolMessage extends SpotBufferedMessageBase {
  kind: 'BOOK_TICKER' | 'AGG_TRADE';
  symbol: string;
}

export type SpotBufferedMessage = SpotBufferedMiniTickerFrame | SpotBufferedSymbolMessage;

export interface SpotBufferOfferResult {
  state: 'ACCEPTED' | 'COALESCED' | 'DROPPED';
  reason: 'NONE' | 'REPLACED_STATE' | 'CAPACITY' | 'PAYLOAD_TOO_LARGE' | 'INVALID_PAYLOAD' | 'OUT_OF_ORDER_REPLACEMENT';
  depth: number;
}

export interface SpotGenerationDropResult {
  total: number;
  miniTicker: number;
  bookTicker: number;
  aggregateTrade: number;
}

export interface SpotFrameIngestResult {
  state: 'ACCEPTED' | 'PARTIAL' | 'REJECTED' | 'IGNORED_GENERATION';
  correlationId: string;
  changedOnlySemantics: true;
  fullUniverseFrame: boolean;
  receivedRecords: number;
  acceptedRecords: number;
  invalidRecords: number;
  unknownSymbols: number;
  duplicateRecords: number;
  outOfOrderRecords: number;
  staleRecords: number;
  droppedRecords: number;
  observations: readonly SpotRolling24hObservation[];
  events: readonly RuntimeSourceEvent<SpotRolling24hObservation>[];
  failures: readonly StableFailure[];
}

export interface SpotEvidenceIngestResult<T extends NormalizedBookTicker | NormalizedTrade> {
  state: 'ACCEPTED' | 'REJECTED' | 'IGNORED_GENERATION';
  correlationId: string;
  evidence: T | null;
  qualityFailures: readonly StableFailure[];
  failures: readonly StableFailure[];
}

export interface SpotSymbolSnapshot {
  instrument: InstrumentIdentity;
  ticker24h: SpotRolling24hObservation | null;
  tickerFreshness: SpotFreshnessState;
  bookTicker: NormalizedBookTicker | null;
  bookFreshness: SpotFreshnessState;
  recentTrades: readonly NormalizedTrade[];
  tradeFreshness: SpotFreshnessState;
}

export interface SpotRuntimeSnapshot {
  sourceId: 'binance-spot-market-stream';
  observedState: RuntimeLifecycleState;
  connectionGeneration: number;
  connectedAtMs: number | null;
  lastTransportReceiveTimeMs: number | null;
  lastUsefulReceiveTimeMs: number | null;
  lastProcessedTimeMs: number | null;
  messageAgeMs: number | null;
  processingLagMs: number | null;
  changedOnlySemantics: true;
  quietSymbolsRetained: true;
  tickerVolumeWindow: 'ROLLING_24H';
  sources: readonly RuntimeSourceSnapshot[];
  symbols: readonly SpotSymbolSnapshot[];
  metrics: SpotSourceMetrics;
  backpressure: SpotBackpressureSnapshot;
  snapshotTimeMs: number;
}
