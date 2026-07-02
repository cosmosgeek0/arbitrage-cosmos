export type SymbolStatus = 'idle' | 'watching' | 'signal';
export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';

export interface SymbolRow {
  symbol: string;
  base: string;
  spot: number | null;
  perpMark: number | null;
  basisPct: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
  change24hPct: number | null;
  quoteVolume24h: number | null;
  status: SymbolStatus;
}

export interface AppConfig {
  // basis scanner
  feesPct: number;
  minNetBasisPct: number;
  persistTicks: number;
  minQuoteVolume24h: number;
  // control
  killSwitch: boolean; // true = everything halted
  liveTradingEnabled: boolean; // false = live send blocked even if kill switch is off
  // risk limits
  maxOrderNotionalUsd: number;
  maxDailyNotionalUsd: number;
  maxDailyLossUsd: number;
  maxOpenOrders: number;
  cooldownSec: number;
  allowedSymbols: string[]; // empty = nothing may trade
  blockedSymbols: string[];
  staleOrderMaxMin: number; // orders older than this are flagged in the UI
  watchlist: string[]; // starred symbols on the Markets page
}

export interface OrderIntent {
  symbol: string;
  side: Side;
  type: OrderType;
  quantity?: number;
  quoteQty?: number; // MARKET by quote amount
  price?: number; // LIMIT
  source: 'manual' | 'proposal';
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
