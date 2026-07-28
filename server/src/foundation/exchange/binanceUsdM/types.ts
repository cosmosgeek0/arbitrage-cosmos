/**
 * Dormant Binance USD-M boundary ports and value types.
 *
 * The boundary deliberately knows only request paths. It owns no concrete
 * network client, credential lookup, timer, or runtime hook. A future adapter
 * must inject all transport, clock, signing, timeout, and abort behavior.
 */
import type {
  DataAuthority,
  SourcedTimestamp,
  StructuredFailure,
  TransportOutcome,
} from '../../contracts/index.js';

export const BINANCE_USDM_ENDPOINTS = Object.freeze({
  SERVER_TIME: Object.freeze({ method: 'GET', path: '/fapi/v1/time', security: 'NONE', idempotent: true, weight: 1 }),
  EXCHANGE_INFO: Object.freeze({ method: 'GET', path: '/fapi/v1/exchangeInfo', security: 'NONE', idempotent: true, weight: 1 }),
  MARK_FUNDING: Object.freeze({ method: 'GET', path: '/fapi/v1/premiumIndex', security: 'NONE', idempotent: true, weight: 1 }),
  FUNDING_RATE: Object.freeze({ method: 'GET', path: '/fapi/v1/fundingRate', security: 'NONE', idempotent: true, weight: null }),
  ACCOUNT: Object.freeze({ method: 'GET', path: '/fapi/v3/account', security: 'SIGNED', idempotent: true, weight: 5 }),
  BALANCE: Object.freeze({ method: 'GET', path: '/fapi/v3/balance', security: 'SIGNED', idempotent: true, weight: 5 }),
  POSITIONS: Object.freeze({ method: 'GET', path: '/fapi/v3/positionRisk', security: 'SIGNED', idempotent: true, weight: 5 }),
  ORDER: Object.freeze({ method: 'GET', path: '/fapi/v1/order', security: 'SIGNED', idempotent: true, weight: 1 }),
  OPEN_ORDERS: Object.freeze({ method: 'GET', path: '/fapi/v1/openOrders', security: 'SIGNED', idempotent: true, weight: null }),
  USER_TRADES: Object.freeze({ method: 'GET', path: '/fapi/v1/userTrades', security: 'SIGNED', idempotent: true, weight: 5 }),
  TEST_ORDER: Object.freeze({ method: 'POST', path: '/fapi/v1/order/test', security: 'SIGNED', idempotent: false, weight: 1 }),
} as const);

export type BinanceUsdMOperation = keyof typeof BINANCE_USDM_ENDPOINTS;
export type BinanceUsdMPath = (typeof BINANCE_USDM_ENDPOINTS)[BinanceUsdMOperation]['path'];
export type BinanceUsdMMethod = 'GET' | 'POST';
export type BinanceUsdMSecurity = 'NONE' | 'SIGNED';

export interface BinanceUsdMClock {
  /** UTC milliseconds. Implementations must be monotonic for one request. */
  nowMs(): number;
}

/** Minimal abort shape so this pure boundary does not require a concrete API. */
export interface BinanceUsdMAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
}

export interface BinanceUsdMTransportRequest {
  readonly operation: BinanceUsdMOperation;
  readonly method: BinanceUsdMMethod;
  readonly path: BinanceUsdMPath;
  /** Encoded query without a leading question mark. */
  readonly query: string;
  /** application/x-www-form-urlencoded body for TEST_ORDER; null for GET. */
  readonly body: string | null;
  readonly headers: Readonly<Record<string, string>>;
  /** Enforced by the injected transport. This module creates no timers. */
  readonly timeoutMs: number;
  readonly signal?: BinanceUsdMAbortSignal;
  readonly idempotent: boolean;
}

export interface BinanceUsdMTransportResponse {
  readonly outcome: TransportOutcome;
  readonly status: number | null;
  readonly headers?: Readonly<Record<string, string>> | null;
  /** Parsed JSON supplied by the adapter. */
  readonly body?: unknown;
}

export interface BinanceUsdMTransport {
  request(request: BinanceUsdMTransportRequest): Promise<BinanceUsdMTransportResponse>;
}

export interface BinanceUsdMSigner {
  readonly algorithm: 'HMAC_SHA256';
  sign(payload: string): string;
}

export interface BinanceUsdMRequestOptions {
  readonly correlationId: string;
  readonly timeoutMs?: number;
  readonly recvWindowMs?: number;
  readonly signal?: BinanceUsdMAbortSignal;
}

export interface BinanceUsdMClientConfig {
  readonly apiKey: string;
  readonly clock: BinanceUsdMClock;
  readonly transport: BinanceUsdMTransport;
  readonly signer: BinanceUsdMSigner;
  /** Provenance of public data returned by this injected transport. */
  readonly publicDataAuthority: DataAuthority;
  /** Freshness policy for exchangeInfo symbol/filter facts. */
  readonly exchangeInfoMaxAgeMs: number;
  readonly recvWindowMs?: number;
  readonly timeoutMs?: number;
  /** 1..3. Applied only to GET endpoints. TEST_ORDER is always one attempt. */
  readonly maxReadAttempts?: number;
  /** Named local fallback when Binance rate-limits without a retry header. */
  readonly defaultRateLimitCooldownMs?: number;
}

export type BinanceUsdMErrorKind =
  | 'INPUT'
  | 'CLOCK'
  | 'AUTH'
  | 'ABORTED'
  | 'TIMEOUT'
  | 'AMBIGUOUS'
  | 'RATE_LIMITED'
  | 'HTTP'
  | 'VENUE'
  | 'MALFORMED'
  | 'FILTER'
  | 'COOLDOWN';

export interface BinanceUsdMError extends StructuredFailure {
  readonly kind: BinanceUsdMErrorKind;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly ambiguous: boolean;
  readonly transportOutcome: TransportOutcome;
  readonly httpStatus: number | null;
  readonly venueCode: number | null;
  /** Venue text is length-bounded and scrubbed before exposure. */
  readonly venueMessage: string | null;
}

export interface BinanceUsdMRateLimitMetadata {
  readonly usedWeight1m: number | null;
  readonly orderCount10s: number | null;
  readonly orderCount1m: number | null;
  readonly retryAfterMs: number | null;
  readonly cooldownUntilMs: number | null;
  readonly cooldownSource: 'VENUE_HEADER' | 'LOCAL_POLICY' | null;
}

export interface BinanceUsdMResponseMetadata {
  readonly operation: BinanceUsdMOperation;
  readonly method: BinanceUsdMMethod;
  readonly path: BinanceUsdMPath;
  readonly idempotent: boolean;
  readonly attempts: number;
  readonly startedAtMs: number;
  readonly receivedAtMs: number;
  readonly serverOffsetMs: number | null;
  readonly rateLimit: BinanceUsdMRateLimitMetadata;
}

export type BinanceUsdMResult<T> =
  | { readonly ok: true; readonly value: T; readonly metadata: BinanceUsdMResponseMetadata }
  | { readonly ok: false; readonly error: BinanceUsdMError; readonly metadata: BinanceUsdMResponseMetadata };

export interface BinanceUsdMServerTime {
  readonly serverTimeMs: number;
  /** serverTime - midpoint(local send, local receive). */
  readonly offsetMs: number;
  readonly roundTripMs: number;
}

export interface BinanceUsdMPriceFilter {
  readonly minPrice: string;
  readonly maxPrice: string;
  readonly tickSize: string;
}

export interface BinanceUsdMLotSizeFilter {
  readonly minQty: string;
  readonly maxQty: string;
  readonly stepSize: string;
}

export interface BinanceUsdMPercentPriceFilter {
  readonly multiplierUp: string;
  readonly multiplierDown: string;
  readonly multiplierDecimal: number;
}

export interface BinanceUsdMSymbolFilters {
  readonly price: BinanceUsdMPriceFilter | null;
  readonly lotSize: BinanceUsdMLotSizeFilter | null;
  readonly marketLotSize: BinanceUsdMLotSizeFilter | null;
  readonly minNotional: string | null;
  readonly percentPrice: BinanceUsdMPercentPriceFilter | null;
  /** Public venue limit; evaluation also requires current private open-order truth. */
  readonly maxNumOrders: number | null;
  /**
   * Venue filter families this boundary cannot enforce from public facts.
   * Any entry makes local order validation unavailable rather than permissive.
   */
  readonly unsupportedFilterTypes: readonly string[];
}

export interface BinanceUsdMRateLimitRule {
  readonly rateLimitType: string;
  readonly interval: string;
  readonly intervalNum: number;
  readonly limit: number;
}

export interface BinanceUsdMExchangeSymbol {
  readonly symbol: string;
  readonly status: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly marginAsset: string;
  readonly orderTypes: readonly string[];
  readonly timeInForce: readonly string[];
  readonly filters: BinanceUsdMSymbolFilters;
  readonly observedAt: Readonly<SourcedTimestamp>;
}

export interface BinanceUsdMExchangeInfo {
  readonly timezone: string;
  readonly rateLimits: readonly BinanceUsdMRateLimitRule[];
  readonly symbols: readonly BinanceUsdMExchangeSymbol[];
}

export interface BinanceUsdMMarkFunding {
  readonly symbol: string;
  readonly markPrice: string;
  readonly indexPrice: string;
  readonly estimatedSettlePrice: string;
  readonly lastFundingRate: string;
  readonly interestRate: string;
  readonly nextFundingTimeMs: number;
  readonly sourceTimeMs: number;
}

export type BinanceUsdMFundingRateType = 'Regular' | 'Special';

export interface BinanceUsdMFundingRate {
  readonly symbol: string;
  readonly fundingRate: string;
  readonly fundingTimeMs: number;
  readonly markPrice: string | null;
  readonly rateType: BinanceUsdMFundingRateType;
}

export interface BinanceUsdMAccountAsset {
  readonly asset: string;
  readonly walletBalance: string;
  readonly unrealizedProfit: string;
  readonly marginBalance: string;
  readonly availableBalance: string;
  readonly maxWithdrawAmount: string;
  readonly updateTimeMs: number;
}

export interface BinanceUsdMAccountPosition {
  readonly symbol: string;
  readonly positionSide: string;
  readonly positionAmt: string;
  readonly unrealizedProfit: string;
  readonly isolatedMargin: string;
  readonly notional: string;
  readonly isolatedWallet: string;
  readonly initialMargin: string;
  readonly maintMargin: string;
  readonly updateTimeMs: number;
}

export interface BinanceUsdMAccount {
  readonly totalInitialMargin: string;
  readonly totalMaintMargin: string;
  readonly totalWalletBalance: string;
  readonly totalUnrealizedProfit: string;
  readonly totalMarginBalance: string;
  readonly totalPositionInitialMargin: string;
  readonly totalOpenOrderInitialMargin: string;
  readonly totalCrossWalletBalance: string;
  readonly totalCrossUnPnl: string;
  readonly availableBalance: string;
  readonly maxWithdrawAmount: string;
  readonly assets: readonly BinanceUsdMAccountAsset[];
  readonly positions: readonly BinanceUsdMAccountPosition[];
}

export interface BinanceUsdMBalance {
  readonly accountAlias: string;
  readonly asset: string;
  readonly balance: string;
  readonly crossWalletBalance: string;
  readonly crossUnPnl: string;
  readonly availableBalance: string;
  readonly maxWithdrawAmount: string;
  readonly marginAvailable: boolean | null;
  readonly updateTimeMs: number;
}

export interface BinanceUsdMPosition {
  readonly symbol: string;
  readonly positionSide: string;
  readonly positionAmt: string;
  readonly entryPrice: string;
  readonly breakEvenPrice: string;
  readonly markPrice: string;
  readonly unrealizedProfit: string;
  readonly liquidationPrice: string;
  readonly isolatedMargin: string;
  readonly notional: string;
  readonly marginAsset: string;
  readonly isolatedWallet: string;
  readonly initialMargin: string;
  readonly maintMargin: string;
  readonly updateTimeMs: number;
}

export interface BinanceUsdMOrder {
  readonly symbol: string;
  readonly orderId: number;
  readonly clientOrderId: string;
  readonly price: string;
  readonly avgPrice: string;
  readonly origQty: string;
  readonly executedQty: string;
  readonly cumQuote: string;
  readonly status: string;
  readonly timeInForce: string;
  readonly type: string;
  readonly origType: string;
  readonly side: string;
  readonly positionSide: string;
  readonly reduceOnly: boolean;
  readonly closePosition: boolean;
  readonly stopPrice: string;
  readonly timeMs: number;
  readonly updateTimeMs: number;
}

export interface BinanceUsdMTrade {
  readonly symbol: string;
  readonly id: number;
  readonly orderId: number;
  readonly price: string;
  readonly qty: string;
  readonly quoteQty: string;
  readonly commission: string;
  readonly commissionAsset: string;
  readonly realizedPnl: string;
  readonly side: string;
  readonly positionSide: string;
  readonly buyer: boolean;
  readonly maker: boolean;
  readonly timeMs: number;
}

export type BinanceUsdMOrderSide = 'BUY' | 'SELL';
export type BinanceUsdMPositionSide = 'BOTH' | 'LONG' | 'SHORT';
export type BinanceUsdMPositionMode = 'ONE_WAY' | 'HEDGE';
export type BinanceUsdMOrderType =
  | 'LIMIT'
  | 'MARKET'
  | 'STOP'
  | 'STOP_MARKET'
  | 'TAKE_PROFIT'
  | 'TAKE_PROFIT_MARKET'
  | 'TRAILING_STOP_MARKET';
export type BinanceUsdMTimeInForce = 'GTC' | 'IOC' | 'FOK' | 'GTX' | 'GTD' | 'RPI';

export interface BinanceUsdMTestOrderInput {
  readonly symbol: string;
  readonly side: BinanceUsdMOrderSide;
  readonly type: BinanceUsdMOrderType;
  /** Explicit local truth; never inferred from positionSide. */
  readonly positionMode: BinanceUsdMPositionMode;
  readonly positionSide: BinanceUsdMPositionSide;
  readonly quantity?: string;
  readonly price?: string;
  readonly stopPrice?: string;
  readonly activationPrice?: string;
  readonly callbackRate?: string;
  readonly timeInForce?: BinanceUsdMTimeInForce;
  readonly reduceOnly?: boolean;
  readonly closePosition?: boolean;
  readonly goodTillDateMs?: number;
  readonly newClientOrderId?: string;
  /** Required for MIN_NOTIONAL when no order price exists and PERCENT_PRICE. */
  readonly notionalReferencePrice?: string;
  /** Parsed exchangeInfo symbol facts; binds filters and capabilities to symbol. */
  readonly exchangeSymbol: BinanceUsdMExchangeSymbol;
}

export interface BinanceUsdMTestOrderAccepted {
  readonly validationAccepted: true;
  readonly submittedToMatchingEngine: false;
  readonly endpoint: '/fapi/v1/order/test';
  readonly symbol: string;
  readonly venueOrderId: number;
  readonly venueClientOrderId: string;
  readonly updateTimeMs: number;
}

export interface BinanceUsdMOrderQuery {
  readonly symbol: string;
  readonly orderId?: number;
  readonly origClientOrderId?: string;
}

export interface BinanceUsdMUserTradesQuery {
  readonly symbol: string;
  readonly orderId?: number;
  readonly startTimeMs?: number;
  readonly endTimeMs?: number;
  readonly fromId?: number;
  readonly limit?: number;
}

export interface BinanceUsdMFundingRatesQuery {
  readonly symbol?: string;
  readonly startTimeMs?: number;
  readonly endTimeMs?: number;
  readonly limit?: number;
}

export interface BinanceUsdMCooldownState {
  readonly active: boolean;
  readonly cooldownUntilMs: number | null;
  readonly remainingMs: number | null;
  readonly source: 'VENUE_HEADER' | 'LOCAL_POLICY' | null;
}
