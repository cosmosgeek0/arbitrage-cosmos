export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';

export interface AppConfig {
  feesPct: number;
  minNetBasisPct: number;
  persistTicks: number;
  minQuoteVolume24h: number;
  killSwitch: boolean;
  liveTradingEnabled: boolean;
  maxOrderNotionalUsd: number;
  maxDailyNotionalUsd: number;
  maxDailyLossUsd: number;
  maxOpenOrders: number;
  cooldownSec: number;
  allowedSymbols: string[];
  blockedSymbols: string[];
  staleOrderMaxMin: number;
  watchlist: string[];
}

export interface MarketRow {
  symbol: string;
  base: string;
  spot: number | null;
  perpMark: number | null;
  basisPct: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
  change24hPct: number | null;
  quoteVolume24h: number | null;
  high24h: number | null;
  low24h: number | null;
  status: 'idle' | 'watching' | 'signal';
  spark: number[];
  hasPerp: boolean;
}

export interface MarketDetail {
  row: MarketRow | null;
  book: { bidPrice: number; bidQty: number; askPrice: number; askQty: number } | null;
  filters: { stepSize: number; minQty: number; tickSize: number; minNotional: number } | null;
  last: number | null;
  change24hPct: number | null;
  watchlisted: boolean;
  allowlisted: boolean;
}

export interface MarginSnapshot {
  available: boolean;
  error: string | null;
  fetchedAt: number | null;
  borrowEnabled: boolean;
  marginLevel: number | null;
  totalAssetBtc: number;
  totalLiabilityBtc: number;
  totalNetAssetBtc: number;
  assets: { asset: string; free: number; locked: number; borrowed: number; interest: number; netAsset: number }[];
  interestHistory: { asset: string; interest: number; rate: number; ts: number }[];
  borrowRecords: { asset: string; amount: number; ts: number; status: string }[];
  repayRecords: { asset: string; amount: number; ts: number; status: string }[];
}

export interface LoansSnapshot {
  available: boolean;
  error: string | null;
  fetchedAt: number | null;
  ongoing: { loanCoin: string; collateralCoin: string; totalDebt: number; collateralAmount: number; currentLTV: number }[];
  loanable: { loanCoin: string; hourlyRatePct: number; yearlyRatePct: number; minLimit: number; maxLimit: number }[];
  collateral: { collateralCoin: string; initialLTV: number; marginCallLTV: number; liquidationLTV: number; maxLimit: number }[];
  margin: MarginSnapshot;
}

export interface BalanceEntry {
  asset: string;
  free: number;
  locked: number;
  priceUsdt: number | null;
  valueUsdt: number;
}

export interface PositionEntry extends BalanceEntry {
  avgCost: number | null;
  unrealizedUsd: number | null;
}

export interface OpenOrderRow {
  symbol: string;
  orderId: number;
  clientOrderId: string | null;
  side: string;
  type: string;
  price: number;
  origQty: number;
  executedQty: number;
  status: string;
  time: number;
  stale: boolean;
}

export interface FillRow {
  symbol: string;
  tradeId: number;
  orderId: number | null;
  side: string;
  price: number;
  qty: number;
  quoteQty: number;
  commission: number;
  commissionAsset: string | null;
  ts: number;
  source: string;
}

export interface Proposal {
  id: number;
  symbol: string;
  side: 'SHORT_PERP_LONG_SPOT' | 'LONG_PERP_SHORT_SPOT';
  openedTs: number;
  basisOpen: number;
  basisNow: number;
  basisPeak: number;
  fundingRate: number | null;
  spotPrice: number | null;
  perpMark: number | null;
  feesPct: number;
  netEdgePct: number;
  borrow: string;
  reason: string;
  confidence: number;
  quoteVolume24h: number | null;
}

export interface LedgerEvent {
  id: number;
  ts: number;
  kind: string;
  symbol: string | null;
  data: unknown;
}

export interface RiskCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface RiskDecision {
  allowed: boolean;
  checks: RiskCheck[];
  reasons: string[];
}

export interface PreviewResult {
  ok: boolean;
  errors: string[];
  symbol: string;
  side: string;
  type: string;
  lastPrice: number | null;
  effectivePrice: number | null;
  quantity: number | null;
  quoteQty: number | null;
  estNotionalUsd: number | null;
  filters: { stepSize: number; minQty: number; tickSize: number; minNotional: number } | null;
  risk: RiskDecision;
}

export interface SendResult {
  sent: boolean;
  risk?: RiskDecision;
  error?: string;
  order?: { orderId: number; status: string; executedQty: string; cummulativeQuoteQty: string };
}

export interface ServerState {
  now: number;
  mode: 'HALTED' | 'MANUAL' | 'LIVE_ARMED';
  binance: {
    keysPresent: boolean;
    connected: boolean;
    lastSyncTs: number | null;
    lastError: string | null;
    canWithdraw: boolean | null;
    canTrade: boolean | null;
    userStream: string;
  };
  feeds: Record<string, string>;
  config: AppConfig;
  account: {
    totalUsdt: number;
    availableUsdt: number;
    dayOpenEquity: number | null;
    dayChangeUsd: number | null;
    realizedTodayUsd: number;
    entries: BalanceEntry[];
  } | null;
  positions: PositionEntry[];
  openOrders: OpenOrderRow[];
  recentFills: FillRow[];
  proposals: Proposal[];
  scanner: { pairs: number; watching: number; lastTickTs: number | null; grossThresholdPct: number };
  risk: { dailyNotionalUsedUsd: number; lastOrderTs: number | null; rejectionsToday: number };
  events: LedgerEvent[];
}

export interface TicketPrefill {
  symbol?: string;
  side?: Side;
  type?: OrderType;
  price?: number;
  quantity?: number;
  quoteQty?: number;
  source?: 'manual' | 'proposal';
}

export interface SignalRecord {
  id: number;
  symbol: string;
  side: string;
  openedTs: number;
  closedTs: number | null;
  basisOpen: number;
  basisPeak: number;
  basisClose: number | null;
  fundingOpen: number | null;
}

export interface Quote {
  symbol: string;
  last: number | null;
  change24hPct: number | null;
  tradable: boolean;
  book: { bidPrice: number; bidQty: number; askPrice: number; askQty: number } | null;
}
