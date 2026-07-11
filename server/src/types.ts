export type SymbolStatus = 'idle' | 'watching' | 'signal';
export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type ControlMode = 'blocked' | 'paused' | 'allowed';

export interface ExecutionControlModes {
  funds: ControlMode;
  borrowing: ControlMode;
  automation: ControlMode;
  liveOrders: ControlMode;
}

export interface SymbolRow {
  symbol: string;
  base: string;
  spot: number | null;
  spotBid?: number | null;
  spotAsk?: number | null;
  spotBidQty?: number | null;
  spotAskQty?: number | null;
  spotSpreadPct?: number | null;
  spotTopQuoteUsd?: number | null;
  perpMark: number | null;
  perpIndexPrice?: number | null;
  markIndexBasisPct?: number | null;
  perpLast?: number | null;
  perpChange24hPct?: number | null;
  perpVolume24h?: number | null;
  perpHigh24h?: number | null;
  perpLow24h?: number | null;
  perpBid?: number | null;
  perpAsk?: number | null;
  perpBidQty?: number | null;
  perpAskQty?: number | null;
  perpSpreadPct?: number | null;
  perpTopQuoteUsd?: number | null;
  basisPct: number | null;
  openInterest?: number | null;
  openInterestUsd?: number | null;
  openInterestChangePct?: number | null;
  openInterestUpdatedAt?: number | null;
  oiToPerpVolume24h?: number | null;
  liquidations15mUsd?: number | null;
  longLiquidations15mUsd?: number | null;
  shortLiquidations15mUsd?: number | null;
  executableBasisLongSpotPct?: number | null;
  executableBasisShortSpotPct?: number | null;
  executableBasisBestPct?: number | null;
  executableBasisSide?: 'LONG_SPOT_SHORT_PERP' | 'SHORT_SPOT_LONG_PERP' | null;
  fundingAnnualPct?: number | null;
  fundingRate: number | null;
  nextFundingTime: number | null;
  change24hPct: number | null;
  quoteVolume24h: number | null;
  high24h: number | null;
  low24h: number | null;
  status: SymbolStatus;
  hasSpot?: boolean;
  hasPerp?: boolean;
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
  fundsLocked: boolean; // true = money-state-changing actions are blocked
  automationPaused: boolean; // true = proposal/bot-originated live sends are blocked
  controlModes: ExecutionControlModes; // explicit operator intent behind the legacy fail-closed booleans
  // risk limits
  maxOrderNotionalUsd: number;
  maxDailyNotionalUsd: number;
  maxDailyLossUsd: number;
  maxOpenOrders: number;
  cooldownSec: number;
  allowedSymbols: string[]; // empty = nothing may trade
  blockedSymbols: string[];
  staleOrderMaxMin: number; // orders older than this are flagged in the UI
  borrowGuard: BorrowGuardConfig;
  watchlist: string[]; // starred symbols on the Markets page
  // owner profile (avatar stored as a small data URL so it follows the server,
  // not the browser)
  profile: { name: string; avatar: string | null };
  // owner-authored governance rules. Recorded + ledgered now; the risk engine
  // starts consuming `strict` rules when live mode lands.
  customRules: CustomRule[];
}

export interface BorrowGuardConfig {
  enabled: boolean;
  newBorrowPaused: boolean;
  repayOnly: boolean;
  maxLtvPct: number;
  maxAprPct: number;
  maxBorrowNotionalUsd: number;
  requireLiveCatalog: boolean;
  allowedCollateralCoins: string[];
  blockedLoanCoins: string[];
}

export interface CustomRule {
  id: string;
  name: string;
  scope: 'orders' | 'symbols' | 'strategy' | 'hours' | 'general';
  effect: 'allow' | 'block' | 'limit';
  note: string;
  strict: boolean;
  createdAt: number;
}

export interface OrderIntent {
  symbol: string;
  side: Side;
  type: OrderType;
  quantity?: number;
  quoteQty?: number; // MARKET by quote amount
  price?: number; // LIMIT
  timeInForce?: 'GTC' | 'IOC' | 'FOK'; // LIMIT only, default GTC
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
