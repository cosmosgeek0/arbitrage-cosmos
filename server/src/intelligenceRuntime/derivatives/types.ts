import type {
  PublicRestTransport,
  RuntimeClock,
  RuntimeRateBudgetState,
  RuntimeSourceEvent,
} from '../contracts/index.js';
import type { FuturesLiquidationObservation } from '../futures/index.js';

export const DERIVATIVES_FACT_KINDS = Object.freeze([
  'OPEN_INTEREST_CURRENT',
  'OPEN_INTEREST_HISTORY',
  'FUNDING_HISTORY',
  'FUNDING_INFO',
  'TAKER_BUY_SELL',
  'GLOBAL_LONG_SHORT',
  'TOP_TRADER_ACCOUNT',
  'TOP_TRADER_POSITION',
  'LIQUIDATION_CONTEXT',
] as const);

export type DerivativesFactKind = (typeof DERIVATIVES_FACT_KINDS)[number];
export type RefreshableDerivativesFactKind = Exclude<
  DerivativesFactKind,
  'TOP_TRADER_ACCOUNT' | 'TOP_TRADER_POSITION' | 'LIQUIDATION_CONTEXT'
>;

export const DERIVATIVES_PERIODS = Object.freeze([
  '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d',
] as const);
export type DerivativesPeriod = (typeof DERIVATIVES_PERIODS)[number];

export type DerivativesAccess = 'PUBLIC_NO_KEY' | 'API_KEY_REQUIRED' | 'PUBLIC_STREAM_INPUT';
export type DerivativesAvailability =
  | 'AVAILABLE'
  | 'STALE'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INVALID';
export type DerivativesCompleteness = 'COMPLETE' | 'PARTIAL' | 'SAMPLED' | 'MISSING';

export interface DerivativesSourceDescriptor {
  kind: DerivativesFactKind;
  sourceId: string;
  dataset: string;
  baseUrl: string;
  pathOrStream: string;
  endpoint: string;
  documentationUrl: string;
  access: DerivativesAccess;
  officialIpWeight: number | null;
  sharedLimit: string | null;
  localBudgetUnits: number;
  ttlMs: number;
  notes: readonly string[];
}

export interface DerivativesError {
  code:
    | 'NOT_OBSERVED'
    | 'TRANSPORT_UNAVAILABLE'
    | 'RATE_BUDGET_BLOCKED'
    | 'RATE_LIMITED'
    | 'API_KEY_REQUIRED'
    | 'ACCESS_BLOCKED'
    | 'HTTP_ERROR'
    | 'INVALID_RESPONSE'
    | 'TIMESTAMP_SKEW'
    | 'STALE_SOURCE'
    | 'PRIOR_GENERATION'
    | 'SOURCE_DISAGREEMENT'
    | 'CAPACITY_EXCEEDED';
  message: string;
  status: number | null;
  retryable: boolean;
  observedAtMs: number;
}

export interface DerivativesRequestCost {
  officialIpWeight: number | null;
  sharedLimit: string | null;
  localBudgetUnits: number;
  chargedBudgetUnits: number;
}

export interface OpenInterestCurrentValue {
  kind: 'OPEN_INTEREST_CURRENT';
  openInterest: number;
}

export interface OpenInterestHistoryRow {
  symbol: string;
  openInterest: number;
  openInterestValue: number;
  circulatingSupply: number | null;
  timestampMs: number;
}

export interface OpenInterestHistoryValue {
  kind: 'OPEN_INTEREST_HISTORY';
  period: DerivativesPeriod;
  rows: readonly OpenInterestHistoryRow[];
}

export interface FundingHistoryRow {
  symbol: string;
  fundingRate: number;
  markPrice: number | null;
  fundingTimeMs: number;
}

export interface FundingHistoryValue {
  kind: 'FUNDING_HISTORY';
  rows: readonly FundingHistoryRow[];
}

export interface FundingInfoValue {
  kind: 'FUNDING_INFO';
  /** false is a complete response with no adjustment row; null is unknown. */
  adjusted: boolean | null;
  fundingIntervalHours: number | null;
  adjustedFundingRateCap: number | null;
  adjustedFundingRateFloor: number | null;
}

export interface TakerBuySellRow {
  buySellRatio: number;
  buyVolume: number;
  sellVolume: number;
  timestampMs: number;
}

export interface TakerBuySellValue {
  kind: 'TAKER_BUY_SELL';
  period: DerivativesPeriod;
  rows: readonly TakerBuySellRow[];
}

export interface GlobalLongShortRow {
  symbol: string;
  longShortRatio: number;
  longAccount: number;
  shortAccount: number;
  timestampMs: number;
}

export interface GlobalLongShortValue {
  kind: 'GLOBAL_LONG_SHORT';
  period: DerivativesPeriod;
  rows: readonly GlobalLongShortRow[];
}

export interface LiquidationContextValue {
  kind: 'LIQUIDATION_CONTEXT';
  pair: string;
  orderSide: 'BUY' | 'SELL';
  liquidatedPositionSide: 'LONG' | 'SHORT';
  originalQuantity: number;
  lastFilledQuantity: number;
  accumulatedFilledQuantity: number;
  limitPrice: number | null;
  averagePrice: number | null;
  orderType: string;
  timeInForce: string;
  orderStatus: string;
  samplingWindowMs: 1_000;
  samplingSelection: 'LATEST_PER_SYMBOL';
}

export type DerivativesFactValue =
  | OpenInterestCurrentValue
  | OpenInterestHistoryValue
  | FundingHistoryValue
  | FundingInfoValue
  | TakerBuySellValue
  | GlobalLongShortValue
  | LiquidationContextValue;

export interface DerivativesFact {
  id: string;
  kind: DerivativesFactKind;
  symbol: string;
  source: DerivativesSourceDescriptor;
  sourceTimeMs: number | null;
  receiveTimeMs: number | null;
  evaluatedAtMs: number;
  ttlMs: number;
  expiresAtMs: number | null;
  availability: DerivativesAvailability;
  completeness: DerivativesCompleteness;
  requestCost: DerivativesRequestCost;
  value: DerivativesFactValue | null;
  lastError: DerivativesError | null;
  reasonCodes: readonly string[];
}

export interface DerivativesRateBudgetPort {
  reserve(weight: number, atMs?: number): Readonly<{
    allowed: boolean;
    retryAtMs: number | null;
    reason: string;
    budget: RuntimeRateBudgetState;
  }>;
  observeResponse(input: {
    status: number;
    headers: Readonly<Record<string, string>>;
    observedAtMs?: number;
  }): Readonly<RuntimeRateBudgetState>;
  snapshot(atMs?: number): Readonly<RuntimeRateBudgetState>;
}

export interface DerivativesTtlConfig {
  OPEN_INTEREST_CURRENT: number;
  OPEN_INTEREST_HISTORY: number;
  FUNDING_HISTORY: number;
  FUNDING_INFO: number;
  TAKER_BUY_SELL: number;
  GLOBAL_LONG_SHORT: number;
  LIQUIDATION_CONTEXT: number;
}

export interface DerivativesEnricherConfig {
  maximumSymbols: number;
  maximumRowsPerSeries: number;
  maximumFundingInfoRows: number;
  requestTimeoutMs: number;
  maximumResponseBytes: number;
  maximumFutureSkewMs: number;
  failureRetryMs: number;
  historyLimit: number;
  period: DerivativesPeriod;
  openInterestDisagreementRatio: number;
  openInterestComparisonWindowMs: number;
  ttlMs: DerivativesTtlConfig;
}

export interface DerivativesEnricherPorts {
  transport: PublicRestTransport;
  clock: RuntimeClock;
  rateBudget: DerivativesRateBudgetPort;
  config?: Partial<Omit<DerivativesEnricherConfig, 'ttlMs'>> & {
    ttlMs?: Partial<DerivativesTtlConfig>;
  };
}

export interface DerivativesRefreshTask {
  id: string;
  kind: RefreshableDerivativesFactKind;
  symbols: readonly string[];
  source: DerivativesSourceDescriptor;
  query: Readonly<Record<string, string | number | boolean>>;
  dueAtMs: number;
  priority: number;
}

export interface DerivativesRefreshPlan {
  plannedAtMs: number;
  requestedSymbols: readonly string[];
  includedSymbols: readonly string[];
  omittedSymbols: readonly string[];
  tasks: readonly DerivativesRefreshTask[];
  totalLocalBudgetUnits: number;
}

export interface DerivativesTaskResult {
  taskId: string;
  kind: RefreshableDerivativesFactKind;
  symbols: readonly string[];
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'RATE_LIMITED';
  attempted: boolean;
  detail: string;
}

export interface DerivativesRefreshReport {
  plannedAtMs: number;
  completedAtMs: number;
  plan: DerivativesRefreshPlan;
  results: readonly DerivativesTaskResult[];
  attemptedCount: number;
  succeededCount: number;
  partialCount: number;
  failedCount: number;
  rateLimitedCount: number;
}

export interface DerivativesDisagreement {
  kind: 'OPEN_INTEREST_CURRENT_VS_HISTORY';
  symbol: string;
  state: 'AGREE' | 'DISAGREE' | 'UNKNOWN';
  currentValue: number | null;
  historicalValue: number | null;
  absoluteDifference: number | null;
  relativeDifference: number | null;
  tolerance: number;
  reason: string;
}

export interface DerivativesCoverage {
  requiredFactCount: number;
  availableFactCount: number;
  staleFactCount: number;
  missingFactCount: number;
}

export interface DerivativesSnapshot {
  snapshotTimeMs: number;
  requestedSymbols: readonly string[];
  includedSymbols: readonly string[];
  omittedSymbols: readonly string[];
  state: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  coverage: DerivativesCoverage;
  facts: readonly DerivativesFact[];
  disagreements: readonly DerivativesDisagreement[];
  budget: RuntimeRateBudgetState;
}

export interface LiquidationIngestResult {
  accepted: boolean;
  reason: 'ACCEPTED' | 'INVALID_SOURCE' | 'INVALID_TIME' | 'PRIOR_GENERATION' | 'OUT_OF_ORDER';
  fact: DerivativesFact | null;
}

export type PublicLiquidationRuntimeEvent = RuntimeSourceEvent<FuturesLiquidationObservation>;
