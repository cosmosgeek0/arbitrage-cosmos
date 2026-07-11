import type {
  NormalizedEvidence,
  StableFailure,
} from '../../intelligenceFoundation/contracts/index.js';
import type {
  RuntimeSourceEvent,
  RuntimeSourceSnapshot,
} from '../contracts/index.js';

export const FUTURES_FEEDS = Object.freeze([
  'BOOK_TICKER',
  'MARK_FUNDING',
  'CONTRACT_INFO',
  'LIQUIDATION',
] as const);

export type FuturesFeed = (typeof FUTURES_FEEDS)[number];

/** Hard safety ceilings. Configuration may tighten these but never expand them. */
export const FUTURES_RUNTIME_HARD_LIMITS = Object.freeze({
  maximumSymbols: 16_384,
  maximumLiquidations: 16_384,
  maximumRecordsPerMessage: 16_384,
  maximumContractBrackets: 1_024,
  maximumFutureSkewMs: 60_000,
  symbolStaleAfterMs: 7 * 24 * 60 * 60_000,
  evidenceMaxAgeMs: 7 * 24 * 60 * 60_000,
  retryCeiling: 100,
} as const);

export interface FuturesStreamDescriptor {
  feed: FuturesFeed;
  endpointClass: 'PUBLIC' | 'MARKET';
  baseUrl: string;
  stream: string;
  url: string;
}

export type FuturesDecodeIssueCode =
  | 'MALFORMED_PAYLOAD'
  | 'INVALID_EVENT_TYPE'
  | 'MISSING_FIELD'
  | 'INVALID_FIELD'
  | 'CROSSED_BOOK'
  | 'IDENTITY_CONFLICT'
  | 'CAPACITY_EXCEEDED'
  | 'RECEIVE_TIME_REGRESSION';

export interface FuturesDecodeIssue {
  code: FuturesDecodeIssueCode;
  recordIndex: number | null;
  field: string | null;
  message: string;
}

export interface FuturesIgnoredRecord {
  recordIndex: number;
  reason: 'COIN_M_ST2' | 'CONTROL_MESSAGE' | 'NON_PERPETUAL_USD_M';
}

export interface FuturesDecodeBatch<T> {
  observations: readonly T[];
  ignored: readonly FuturesIgnoredRecord[];
  issues: readonly FuturesDecodeIssue[];
  overflow: Readonly<{
    records: number;
    contractBrackets: number;
  }>;
  complete: boolean;
}

export interface UsdMRuntimeIdentity {
  symbol: string;
  /**
   * Canonical pair candidate. Some current tiered streams publish official
   * `ps`; mark-price and contract-info publish only `s`, so those candidates
   * must be confirmed by the injected instrument resolver before retention.
   */
  pair: string;
  pairAuthority: 'OFFICIAL_PS' | 'SYMBOL_ONLY_REQUIRES_RESOLUTION' | 'INJECTED_RESOLVER';
  sourceMarketType: 1;
  marketSegment: 'USD_M';
  productFamily: 'USD_M_PERPETUAL';
}

interface FuturesObservationBase extends UsdMRuntimeIdentity {
  /** Preserved official source record used directly by foundation normalizers. */
  rawRecord: Readonly<Record<string, unknown>>;
  sourceEventTimeMs: number;
  sourceTransactionTimeMs: number | null;
  receiveTimeMs: number;
  completeness: 'COMPLETE' | 'PARTIAL' | 'SAMPLED';
  missingFields: readonly string[];
}

export interface FuturesBookTickerObservation extends FuturesObservationBase {
  kind: 'USD_M_BOOK_TICKER';
  updateId: string;
  bidPrice: number;
  bidQuantity: number;
  askPrice: number;
  askQuantity: number;
  /** This stream has no last trade price. Never substitute bid, ask, or mark. */
  lastPrice: null;
}

export interface FuturesMarkFundingObservation extends FuturesObservationBase {
  kind: 'USD_M_MARK_FUNDING';
  markPrice: number;
  indexPrice: number;
  estimatedSettlementPrice: number | null;
  movingAverageMarkPrice: number | null;
  fundingRate: number | null;
  fundingIntervalHours: number | null;
  /** Official mark stream `T`; it is not a transaction timestamp. */
  nextFundingTimeMs: number | null;
  /** This stream has no last trade price. Mark is not executable last price. */
  lastPrice: null;
}

export interface FuturesContractBracketObservation {
  bracket: number;
  notionalFloor: number;
  notionalCap: number;
  maintenanceMarginRate: number;
  cumulativeMaintenanceAmount: number;
  minimumLeverage: number;
  maximumLeverage: number;
}

export interface FuturesContractObservation extends FuturesObservationBase {
  kind: 'USD_M_CONTRACT_INFO';
  contractType: string;
  contractStatus: string;
  deliveryTimeMs: number;
  onboardTimeMs: number;
  /** `bks` is event-conditional, so null means "not present in this update", not an empty bracket set. */
  brackets: readonly FuturesContractBracketObservation[] | null;
}

export const CURRENT_LIQUIDATION_SAMPLING = Object.freeze({
  sampledPerWindow: true,
  samplingSelection: 'LATEST_PER_SYMBOL',
  sampleWindowMs: 1_000,
  completeness: 'SAMPLED',
  note: 'Runtime-local current official observation; not normalized through the stale frozen foundation liquidation source fact.',
} as const);

export interface FuturesLiquidationObservation extends FuturesObservationBase {
  kind: 'USD_M_LIQUIDATION_CONTEXT';
  orderSide: 'BUY' | 'SELL';
  liquidatedPositionSide: 'LONG' | 'SHORT';
  orderType: string;
  timeInForce: string;
  orderStatus: string;
  originalQuantity: number;
  lastFilledQuantity: number;
  accumulatedFilledQuantity: number;
  limitPrice: number | null;
  averagePrice: number | null;
  sampledPerWindow: true;
  samplingSelection: 'LATEST_PER_SYMBOL';
  sampleWindowMs: 1_000;
}

export type FuturesObservation =
  | FuturesBookTickerObservation
  | FuturesMarkFundingObservation
  | FuturesContractObservation
  | FuturesLiquidationObservation;

export interface FuturesInstrumentSeed {
  venue?: 'BINANCE';
  productFamily: 'USD_M_PERPETUAL';
  symbol: string;
  pair: string;
  baseAsset: string;
  quoteAsset: string;
  contractType?: 'PERPETUAL' | null;
}

export interface FuturesInstrumentResolver {
  resolve(identity: UsdMRuntimeIdentity): FuturesInstrumentSeed | null;
}

export interface FuturesNormalizedEmission {
  correlationId: string;
  evidenceKind: 'BOOK_TICKER' | 'MARK_PRICE' | 'FUNDING';
  status: 'NORMALIZED' | 'REJECTED' | 'INSTRUMENT_UNAVAILABLE';
  evidence: NormalizedEvidence | null;
  qualityFailures: readonly StableFailure[];
}

export interface FuturesIngestResult {
  feed: FuturesFeed;
  generation: number;
  accepted: number;
  ignored: number;
  invalid: number;
  duplicate: number;
  outOfOrder: number;
  dropped: number;
  overflowRecords: number;
  overflowContractBrackets: number;
  issues: readonly FuturesDecodeIssue[];
  events: readonly RuntimeSourceEvent<FuturesObservation>[];
  normalized: readonly FuturesNormalizedEmission[];
}

export type FuturesObservationFreshness = 'FRESH' | 'STALE' | 'PRIOR_GENERATION';

export interface FuturesObservationSlot<T> {
  observation: T;
  generation: number;
  ageMs: number;
  freshness: FuturesObservationFreshness;
}

export interface FuturesSymbolPriceState {
  bidPrice: number | null;
  askPrice: number | null;
  lastPrice: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  estimatedSettlementPrice: number | null;
}

export interface FuturesSymbolSnapshot extends UsdMRuntimeIdentity {
  prices: FuturesSymbolPriceState;
  fundingRate: number | null;
  fundingIntervalHours: number | null;
  nextFundingTimeMs: number | null;
  book: FuturesObservationSlot<FuturesBookTickerObservation> | null;
  markFunding: FuturesObservationSlot<FuturesMarkFundingObservation> | null;
  contract: FuturesObservationSlot<FuturesContractObservation> | null;
  lastUsefulReceiveTimeMs: number;
}

export interface FuturesRuntimeSnapshot {
  snapshotTimeMs: number;
  sources: readonly RuntimeSourceSnapshot[];
  symbols: readonly FuturesSymbolSnapshot[];
  liquidations: readonly FuturesObservationSlot<FuturesLiquidationObservation>[];
  symbolCapacity: number;
  liquidationCapacity: number;
}
