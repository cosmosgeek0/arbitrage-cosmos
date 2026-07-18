import type {
  JsonValue,
  ProductFamily,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  BaselineCheckpointPort,
  RuntimeClock,
  RuntimeScheduler,
} from '../contracts/index.js';

export const BASELINE_BOOTSTRAP_STATES = Object.freeze([
  'PENDING',
  'FETCHING',
  'RATE_LIMITED',
  'RETRY_WAIT',
  'INSUFFICIENT_HISTORY',
  'PARTIAL',
  'STALE',
  'COMPLETE',
  'UNAVAILABLE',
] as const);

export type BaselineBootstrapState = (typeof BASELINE_BOOTSTRAP_STATES)[number];

export const BASELINE_FIXED_INTERVALS = Object.freeze([
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
  '3d',
  '1w',
] as const);

export type BaselineFixedInterval = (typeof BASELINE_FIXED_INTERVALS)[number];
export type BaselineProductFamily = Extract<ProductFamily, 'SPOT' | 'USD_M_PERPETUAL'>;
export type BaselineListingState = 'ACTIVE' | 'DELISTED' | 'UNAVAILABLE' | 'UNKNOWN';

export interface BaselinePlanItemInput {
  readonly symbol: string;
  readonly instrumentId: string;
  readonly productFamily: BaselineProductFamily;
  /** Identity of the downstream feature family that requested this history. */
  readonly feature: string;
  /** Explicit algorithm/schema version; history is never reused across versions implicitly. */
  readonly featureVersion: string;
  readonly interval: BaselineFixedInterval;
  /** Inclusive requested history boundary. It is aligned up to the interval. */
  readonly requestedStartTimeMs: number;
  /** Exclusive truth boundary. Only candles ending before this boundary can satisfy the plan. */
  readonly targetEndTimeMs: number;
  readonly minimumSamples: number;
  readonly listedAtMs: number | null;
  readonly delistedAtMs: number | null;
  readonly listingState: BaselineListingState;
}

export interface BaselineBootstrapPlanInput {
  readonly name: string;
  readonly version: string;
  readonly items: readonly BaselinePlanItemInput[];
}

export interface BaselineBootstrapConfig {
  readonly configurationVersion: string;
  readonly maximumPlanItems: number;
  readonly maximumParallelism: number;
  readonly historyRequestTimeoutMs: number;
  /** Kept at or below Spot's official maximum so one plan works on both public products. */
  readonly pageLimit: number;
  readonly maximumPagesPerItem: number;
  readonly maximumRecordsPerItem: number;
  readonly focusedBurstLimit: number;
  readonly retryCeiling: number;
  readonly retryBaseDelayMs: number;
  readonly retryMaximumDelayMs: number;
  readonly staleAfterMs: number;
  readonly maximumSymbolLength: number;
  readonly maximumIdentityLength: number;
  readonly maximumMessageLength: number;
}

export interface HistoryFetchRequest {
  readonly requestId: string;
  readonly planId: string;
  readonly planItemId: string;
  readonly sourceId: string;
  readonly productFamily: BaselineProductFamily;
  readonly symbol: string;
  readonly instrumentId: string;
  readonly feature: string;
  readonly featureVersion: string;
  readonly interval: BaselineFixedInterval;
  readonly intervalMs: number;
  readonly baseUrl: string;
  readonly path: '/api/v3/klines' | '/fapi/v1/klines';
  readonly credentials: 'NONE';
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly limit: number;
  readonly estimatedWeight: number;
  readonly tickNowMs: number;
}

export interface HistoryFetchSuccess {
  readonly kind: 'SUCCESS';
  /** Raw official Binance kline tuples. The scheduler validates every field. */
  readonly rows: readonly unknown[];
  readonly hasMore: boolean;
  readonly receiveTimeMs: number;
  readonly actualWeight: number;
}

export interface HistoryFetchRateLimited {
  readonly kind: 'RATE_LIMITED';
  readonly observedAtMs: number;
  readonly retryAtMs: number;
  readonly actualWeight: number;
  readonly message: string;
}

export interface HistoryFetchTransientFailure {
  readonly kind: 'TRANSIENT_FAILURE';
  readonly observedAtMs: number;
  readonly retryAtMs: number | null;
  readonly actualWeight: number;
  readonly message: string;
}

export interface HistoryFetchUnavailable {
  readonly kind: 'UNAVAILABLE';
  readonly observedAtMs: number;
  readonly actualWeight: number;
  readonly message: string;
}

export type HistoryFetchResult =
  | HistoryFetchSuccess
  | HistoryFetchRateLimited
  | HistoryFetchTransientFailure
  | HistoryFetchUnavailable;

export interface HistoryFetchContext {
  readonly method: 'GET';
  readonly signal: AbortSignal;
  readonly deadlineAtMs: number;
}

export interface HistoryPort {
  fetch(
    request: Readonly<HistoryFetchRequest>,
    context: Readonly<HistoryFetchContext>,
  ): Promise<Readonly<HistoryFetchResult>>;
}

export interface RestWeightReservationRequest {
  readonly planId: string;
  readonly planItemId: string;
  readonly requestId: string;
  readonly productFamily: BaselineProductFamily;
  readonly estimatedWeight: number;
  readonly observedAtMs: number;
}

export type RestWeightReservation =
  | {
    readonly kind: 'GRANTED';
    readonly reservationId: string;
  }
  | {
    readonly kind: 'RATE_LIMITED';
    readonly retryAtMs: number;
    readonly reasonCode: string;
  };

export interface RestWeightSettlement {
  readonly reservationId: string;
  readonly planId: string;
  readonly planItemId: string;
  readonly requestId: string;
  readonly estimatedWeight: number;
  readonly actualWeight: number;
  readonly outcome: HistoryFetchResult['kind'] | 'PORT_THROW' | 'TIMEOUT' | 'DISPATCH_ABORTED';
  readonly observedAtMs: number;
}

export interface RestWeightBudgetPort {
  reserve(
    request: Readonly<RestWeightReservationRequest>,
  ): RestWeightReservation | Promise<RestWeightReservation>;
  settle(settlement: Readonly<RestWeightSettlement>): void | Promise<void>;
}

/**
 * Completed aggregate market candle. Decimal quantities stay as canonical
 * exchange strings, avoiding invented precision and fabricated trades.
 */
export interface BaselineCompletedCandle {
  readonly id: string;
  readonly planItemId: string;
  readonly sourceId: string;
  readonly symbol: string;
  readonly instrumentId: string;
  readonly productFamily: BaselineProductFamily;
  readonly feature: string;
  readonly featureVersion: string;
  readonly interval: BaselineFixedInterval;
  readonly openTimeMs: number;
  readonly closeTimeMs: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly baseVolume: string;
  readonly quoteVolume: string;
  readonly tradeCount: number;
  readonly takerBuyBaseVolume: string;
  readonly takerBuyQuoteVolume: string;
  readonly receiveTimeMs: number;
}

export interface BaselineHistoryBatch {
  readonly id: string;
  readonly planId: string;
  readonly planItemId: string;
  readonly requestId: string;
  readonly sourceId: string;
  readonly feature: string;
  readonly featureVersion: string;
  readonly interval: BaselineFixedInterval;
  readonly requestStartTimeMs: number;
  readonly requestEndTimeMs: number;
  readonly receiveTimeMs: number;
  readonly excludedIncompleteCount: number;
  readonly detectedGapCount: number;
  readonly sourceHasMore: boolean;
  readonly nextCursorTimeMs: number;
  readonly records: readonly BaselineCompletedCandle[];
}

/** Implementations must make repeated writes of the same batch id idempotent. */
export interface BaselineSink {
  write(batch: Readonly<BaselineHistoryBatch>): void | Promise<void>;
}

export interface BaselinePlanItemSnapshot {
  readonly id: string;
  readonly symbol: string;
  readonly instrumentId: string;
  readonly productFamily: BaselineProductFamily;
  readonly feature: string;
  readonly featureVersion: string;
  readonly interval: BaselineFixedInterval;
  readonly intervalMs: number;
  readonly state: BaselineBootstrapState;
  /** PARTIAL may be resumable or terminal; this flag makes that distinction explicit. */
  readonly terminal: boolean;
  readonly requestedStartTimeMs: number;
  readonly effectiveStartTimeMs: number;
  readonly targetEndTimeMs: number;
  readonly coverageEndTimeMs: number;
  readonly cursorTimeMs: number;
  readonly listedAtMs: number | null;
  readonly delistedAtMs: number | null;
  readonly listingState: BaselineListingState;
  readonly minimumSamples: number;
  readonly maximumPossibleSamples: number;
  readonly acceptedRecordCount: number;
  readonly excludedIncompleteCount: number;
  readonly duplicateRecordCount: number;
  readonly gapCount: number;
  readonly pageCount: number;
  readonly batchCount: number;
  readonly dispatchCount: number;
  readonly estimatedWeight: number;
  readonly actualWeight: number;
  readonly retryCount: number;
  readonly retryAtMs: number | null;
  readonly lastCompletedCloseTimeMs: number | null;
  readonly lastBatchId: string | null;
  readonly lastReasonCode: string;
  readonly lastMessage: string;
}

export type BaselineStateCounts = Readonly<Record<BaselineBootstrapState, number>>;

export interface BaselineSchedulerTotals {
  readonly items: number;
  readonly acceptedRecords: number;
  readonly excludedIncompleteRecords: number;
  readonly duplicateRecords: number;
  readonly detectedGaps: number;
  readonly pages: number;
  readonly batches: number;
  readonly estimatedWeight: number;
  readonly actualWeight: number;
}

export interface BaselineSchedulerSnapshot {
  readonly id: string;
  readonly planId: string;
  readonly planName: string;
  readonly planVersion: string;
  readonly configurationVersion: string;
  readonly snapshotTimeMs: number;
  readonly restored: boolean;
  readonly activeFetchCount: number;
  readonly maximumParallelism: number;
  readonly focusedDispatchStreak: number;
  readonly dispatchSequence: number;
  readonly integrationGap: string;
  readonly stateCounts: BaselineStateCounts;
  readonly totals: BaselineSchedulerTotals;
  readonly items: readonly BaselinePlanItemSnapshot[];
}

export interface BaselineTickInput {
  readonly focusedSymbols?: readonly string[];
}

export interface BaselineBootstrapSchedulerOptions {
  readonly clock: RuntimeClock;
  readonly deadlineScheduler: RuntimeScheduler;
  readonly history: HistoryPort;
  readonly weightBudget: RestWeightBudgetPort;
  readonly checkpoint: BaselineCheckpointPort;
  readonly sink: BaselineSink;
  readonly config?: Partial<Omit<BaselineBootstrapConfig, 'configurationVersion'>>;
}

/** Checkpoint data remains JSON-only through the frozen injected port. */
export type BaselineCheckpointValue = JsonValue;
