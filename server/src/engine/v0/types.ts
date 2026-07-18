/**
 * Engine Chassis v0 — FROZEN CONTRACTS (Director-owned).
 * Every lane builds against these types. Workers must NOT edit this file;
 * if a contract is wrong, adapt locally in your own module and flag it in
 * your report — the Director reconciles at merge. Source: ENGINE.md §5–§15.
 */

// ---------- time / infra ----------

export interface Clock {
  now(): number; // epoch ms
}

/** Injectable event sink (production adapts Ledger.logEvent; tests use memory). */
export interface EventSink {
  emit(ev: EngineEvent): void;
}

// ---------- market data ----------

export interface SymbolMeta {
  symbol: string; // e.g. BTCUSDT
  base: string;
  quote: string; // USDT
  hasSpot: boolean;
  hasPerp: boolean;
  marginBorrowable: boolean | null; // null = unknown
  // exchange filters as DATA (no network):
  minNotionalUsd: number | null;
  tickSize: number | null;
  stepSize: number | null;
  quoteVolume24hUsd: number | null;
  eligible: boolean;
  ineligibleReason: string | null;
}

export interface BookTicker {
  symbol: string;
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
  ts: number;
}

export interface MarkFunding {
  symbol: string;
  markPrice: number;
  fundingRate: number; // current period rate, e.g. 0.0001
  nextFundingTs: number | null;
  ts: number;
}

export interface TradeTick {
  symbol: string;
  price: number;
  qty: number; // base qty
  quoteQty: number;
  isBuyerMaker: boolean; // true → taker sold
  ts: number;
}

// ---------- rolling windows / features ----------

export type WindowKey = '1s' | '5s' | '15s' | '60s' | '5m' | '1h';
export const WINDOW_KEYS: WindowKey[] = ['1s', '5s', '15s', '60s', '5m', '1h'];

export interface WindowStats {
  quoteVolume: number;
  tradeCount: number;
  avgTradeSize: number; // quote
  priceMovePct: number; // signed, window open→close
  takerBuyRatio: number | null; // 0..1, null if no trades
  largeTradeCount: number;
}

export interface FeatureSnapshot {
  symbol: string;
  ts: number;
  spotBid: number | null;
  spotAsk: number | null;
  perpBid: number | null;
  perpAsk: number | null;
  markPrice: number | null;
  fundingRate: number | null;
  spotSpreadBps: number | null;
  perpSpreadBps: number | null;
  spotStalenessMs: number | null; // null = never seen
  perpStalenessMs: number | null;
  /** executable long-spot/short-perp gap: (perpBid - spotAsk) / spotAsk */
  basisLongSpotPct: number | null;
  /** executable short-spot/long-perp gap: (spotBid - perpAsk) / perpAsk */
  basisShortSpotPct: number | null;
  basisSlopePctPerMin: number | null;
  windows: Partial<Record<WindowKey, WindowStats>>;
  /** volume multiple vs own baseline per window (1 = normal), null = baseline missing */
  volumeMultiple: Partial<Record<WindowKey, number | null>>;
  tradeCountMultiple: Partial<Record<WindowKey, number | null>>;
  baselineReady: boolean;
  depthScore: number | null; // 0..1 quality, null = unknown
}

// ---------- decisions / reasons ----------

export type SymbolState = 'IDLE' | 'WATCHING' | 'FOCUS' | 'PROPOSED' | 'REJECTED' | 'ACTIVE' | 'COOLDOWN';

export type DecisionKind = 'ignore' | 'watch' | 'focus' | 'proposal' | 'reject';

/** Named reject codes — ENGINE.md §8 (basis) + §9 (volume). Do not invent new ones casually. */
export type RejectCode =
  // basis
  | 'data_stale'
  | 'spot_missing'
  | 'perp_missing'
  | 'book_missing'
  | 'edge_below_fees'
  | 'edge_below_threshold'
  | 'spread_too_wide'
  | 'depth_too_thin'
  | 'gap_not_persistent'
  | 'funding_against_trade'
  | 'borrow_required'
  | 'borrow_unknown'
  | 'borrow_unavailable'
  | 'borrow_too_small'
  | 'borrow_cost_too_high'
  | 'symbol_blocked'
  | 'risk_blocked'
  | 'account_not_connected'
  | 'kill_switch_on'
  | 'intake_paused'
  // volume
  | 'baseline_missing'
  | 'volume_not_abnormal'
  | 'one_print_spike'
  | 'trade_count_too_low'
  | 'price_no_followthrough'
  | 'move_already_extended'
  | 'taker_imbalance_missing';

export type StrategyId = 'basis' | 'volume_spike';

export interface Decision {
  symbol: string;
  ts: number;
  strategy: StrategyId;
  kind: DecisionKind;
  rejectCode: RejectCode | null;
  humanReason: string;
  correlationId: string;
  /** decisive numbers snapshotted for the ledger/UI */
  evidence: Record<string, number | string | boolean | null>;
}

// ---------- candidates / focus ----------

export type FocusReason =
  | 'basis_gap'
  | 'volume_activation'
  | 'funding_extreme'
  | 'price_acceleration'
  | 'user_pin'
  | 'open_order'
  | 'open_position';

export type FocusExitReason =
  | 'signal_expired'
  | 'gap_closed'
  | 'volume_normalized'
  | 'spread_depth_invalid'
  | 'risk_rejected'
  | 'max_focus_time'
  | 'cooldown'
  | 'capacity_evicted';

export interface Candidate {
  symbol: string;
  openedTs: number;
  reason: FocusReason;
  score: number; // sortable, explainable
  correlationId: string;
}

export interface FocusSession {
  symbol: string;
  enteredTs: number;
  reason: FocusReason;
  score: number;
  pinned: boolean;
  exitedTs: number | null;
  exitReason: FocusExitReason | null;
  correlationId: string;
}

// ---------- proposals ----------

export type ProposalDirection = 'long_spot_short_perp' | 'short_spot_long_perp' | 'long' | 'short';
export type ProposalStatus = 'open' | 'updated' | 'expired' | 'rejected' | 'approved_manual';

export interface EngineProposal {
  id: string;
  correlationId: string;
  strategy: StrategyId;
  symbol: string;
  direction: ProposalDirection;
  createdTs: number;
  updatedTs: number;
  status: ProposalStatus;
  reason: string; // human
  grossEdgePct: number | null;
  netEdgePct: number | null; // after fees/spread/slippage/funding estimate
  fundingAdjPct: number | null;
  borrowRequired: boolean;
  borrowStatus: 'not_needed' | 'unknown' | 'available' | 'unavailable';
  suggestedNotionalUsd: number | null;
  confidence: number | null; // 0..1
  invalidation: string | null; // human condition
  evidence: Record<string, number | string | boolean | null>;
}

// ---------- risk bridge (feeds the EXISTING services/risk.ts gate) ----------

/** Minimal intent shape the existing risk gate can evaluate. NO executor here. */
export interface OrderIntentStub {
  correlationId: string;
  proposalId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  notionalUsd: number;
  source: 'proposal';
}

export interface RiskVerdictBridge {
  allowed: boolean;
  reasons: string[]; // named reasons from the existing gate
  correlationId: string;
  ts: number;
}

// ---------- ledger events ----------

export type EngineEventKind =
  | 'engine_started'
  | 'engine_stopped'
  | 'heartbeat'
  | 'universe_refreshed'
  | 'feature_snapshot'
  | 'candidate_opened'
  | 'candidate_rejected'
  | 'focus_opened'
  | 'focus_closed'
  | 'strategy_decision'
  | 'proposal_created'
  | 'proposal_updated'
  | 'proposal_expired'
  | 'risk_approved'
  | 'risk_rejected'
  | 'system_error';

export interface EngineEvent {
  kind: EngineEventKind;
  ts: number;
  symbol: string | null;
  strategy: StrategyId | null;
  correlationId: string;
  rejectCode: RejectCode | null;
  message: string;
  payload: Record<string, unknown>;
}

// ---------- API snapshots (ENGINE.md §15 concepts) ----------

export interface EngineStatusSnapshot {
  running: boolean;
  ts: number;
  universeSize: number;
  eligibleSize: number;
  watching: number;
  focused: number;
  openProposals: number;
  lastTickTs: number | null;
  heartbeatAgeMs: number | null;
}

export interface EngineSnapshots {
  status(): EngineStatusSnapshot;
  universe(): SymbolMeta[];
  decisions(limit?: number): Decision[];
  candidates(): Candidate[];
  focus(): FocusSession[];
  proposals(): EngineProposal[];
  events(limit?: number): EngineEvent[];
}

// ---------- module interfaces the lanes implement ----------

export interface FeatureSource {
  snapshot(symbol: string): FeatureSnapshot | null;
  symbols(): string[];
}

export interface Scanner {
  readonly strategy: StrategyId;
  /** Pure decision step: features in, decision out. No I/O. */
  evaluate(f: FeatureSnapshot, ctx: ScanContext): Decision;
}

export interface ScanContext {
  killSwitch: boolean;
  symbolAllowed: boolean;
  borrowStatus: 'not_needed' | 'unknown' | 'available' | 'unavailable';
  nowTs: number;
}
