/**
 * Basis engine — local types. Extends the frozen v0 contracts
 * (engine/v0/types.ts) without touching them. Everything here is plain data:
 * no sockets, no express, no I/O.
 */
import type {
  BookTicker,
  Decision,
  EngineProposal,
  FeatureSnapshot,
  MarkFunding,
  ProposalDirection,
  RejectCode,
  SymbolMeta,
  SymbolState,
} from '../v0/types.js';
import type { BasisRejectCode } from './rejectVocabulary.js';

// ---------- market inputs beyond v0 ----------

/** One side of a depth ladder: [price, baseQty] rows, best first. */
export type LadderLevel = [number, number];

/** Partial depth snapshot (spot or perp leg) — fed by fixtures/replay for now. */
export interface DepthLadder {
  symbol: string;
  bids: LadderLevel[];
  asks: LadderLevel[];
  ts: number;
}

/**
 * Injectable borrow state per base asset (ENGINE.md §11). With no API keys the
 * provider yields status 'unknown' and every reverse-basis signal must
 * terminate in a named reject — never a proposal.
 */
export interface BorrowInfo {
  asset: string;
  status: 'unknown' | 'available' | 'unavailable';
  /** max borrowable in base units; null when unknown */
  maxBorrowableBase: number | null;
  /** hourly interest as pct (0.002 = 0.002%/h); null when unknown */
  hourlyRatePct: number | null;
  asOfTs: number;
}

/** Recent funding observations, oldest→newest, for flip-risk estimation. */
export interface FundingHistoryPoint {
  fundingRate: number;
  ts: number;
}

// ---------- gap tracking ----------

export type BasisDirection = Extract<
  ProposalDirection,
  'long_spot_short_perp' | 'short_spot_long_perp'
>;

/** Rolling state of one executable gap (one symbol, one direction). */
export interface GapState {
  direction: BasisDirection;
  /** current executable gap, pct (may be negative = no gap) */
  gapPct: number | null;
  /** ms since the gap first crossed the watch threshold; null if not open */
  gapAgeMs: number | null;
  /** consecutive scanner ticks the gap held above the entry threshold */
  persistTicks: number;
  /** linear-fit slope of the gap, pct per minute (+ = widening) */
  slopePctPerMin: number | null;
  /** coefficient of variation of the gap over the tracking window (0 = rock stable) */
  stabilityCv: number | null;
  /** samples in the tracking window */
  samples: number;
}

// ---------- funding ----------

export interface FundingContext {
  fundingRate: number | null;
  /** age of the mark/funding observation at snapshot time */
  stalenessMs: number | null;
  /** false unless a finite rate is inside the configured freshness window */
  fresh: boolean;
  nextFundingTs: number | null;
  msToFunding: number | null;
  /**
   * Signed carry estimate over the expected hold, pct of notional.
   * Positive = funding pays this direction, negative = funding drags it.
   */
  carryPctOverHold: number | null;
  /** expected hold used for the carry estimate, ms */
  expectedHoldMs: number;
  /** 0..1 — how likely the funding sign flips based on injected history */
  flipRisk: number | null;
  /** 0..1 bonus when a paying funding event lands inside the expected hold */
  captureFactor: number;
}

// ---------- liquidity / data quality ----------

export interface LiquidityAssessment {
  /** 0..1 combined depth quality at the intended size */
  depthScore: number | null;
  /** estimated round-trip slippage at intended size, pct */
  slippagePct: number;
  /** true when a real ladder informed the estimate (vs top-of-book fallback) */
  ladderBacked: boolean;
  /** ratio of qty available on the side we must hit vs the opposite side (1 = balanced) */
  bookPressure: number | null;
}

export interface DataQuality {
  /** 0..1 composite: staleness, leg skew, mark divergence, ladder availability */
  score: number;
  spotStalenessMs: number | null;
  perpStalenessMs: number | null;
  markStalenessMs: number | null;
  /** |spot book ts − perp book ts| — a gap computed across skewed books is fiction */
  legSkewMs: number | null;
  /** |perp mid − mark| in bps of mark — large divergence smells like a bad tick */
  markDivergenceBps: number | null;
  suspectReasons: string[];
}

// ---------- edge / costs ----------

/** Every cost that eats the gross gap, itemised so proposals are explainable. */
export interface CostBreakdown {
  feesPct: number; // 4 taker legs (open+close, both legs)
  slippagePct: number;
  fundingDragPct: number; // ≥0; drag only (carry bonus shows in netEdgePct)
  borrowCostPct: number; // ≥0; reverse basis only
  totalPct: number;
}

export interface EdgeEstimate {
  direction: BasisDirection;
  grossEdgePct: number | null;
  costs: CostBreakdown;
  /** gross − costs + positive funding carry */
  netEdgePct: number | null;
  fundingAdjPct: number | null;
}

// ---------- priority ----------

/** Explainable ranking: every component visible, product-of-factors overall. */
export interface PriorityScore {
  symbol: string;
  direction: BasisDirection | null;
  score: number;
  components: {
    netEdge: number;
    persistence: number;
    liquidity: number;
    fundingUsefulness: number;
    dataQuality: number;
    momentum: number; // widening bonus / closing penalty from gap slope
  };
}

// ---------- borrow preflight verdict ----------

export interface BorrowVerdict {
  /** v0 proposal-facing status */
  status: 'not_needed' | 'unknown' | 'available' | 'unavailable';
  ok: boolean;
  rejectCode: Extract<BasisRejectCode, 'borrow_unknown' | 'borrow_unavailable' | 'borrow_too_small' | 'borrow_cost_too_high'> | null;
  human: string;
  /** interest over the expected hold, pct of notional (0 when not borrowing) */
  costPctOverHold: number;
}

// ---------- feature snapshot extension ----------

/** Basis-specific signals riding alongside the v0 FeatureSnapshot. */
export interface BasisSignals {
  gapA: GapState; // long_spot_short_perp
  gapB: GapState; // short_spot_long_perp
  funding: { A: FundingContext; B: FundingContext };
  liquidity: { A: LiquidityAssessment; B: LiquidityAssessment };
  dq: DataQuality;
  borrow: BorrowInfo | null; // base-asset borrow state (B needs it)
  /** preflight for direction B at the intended size (A never borrows) */
  borrowVerdictB: BorrowVerdict;
  edge: { A: EdgeEstimate; B: EdgeEstimate };
}

export interface BasisFeatureSnapshot extends FeatureSnapshot {
  basis: BasisSignals;
}

// ---------- lifecycle ----------

export interface SymbolLifecycle {
  symbol: string;
  state: SymbolState;
  correlationId: string | null; // one per signal path, candidate → proposal/reject
  enteredStateTs: number;
  cooldownUntilTs: number | null;
  lastDecision: Decision | null;
  pinned: boolean;
}

// ---------- proposals ----------

/** Staged-size ladder — metadata ONLY, nothing here places orders. */
export interface StagedSize {
  stage: number; // 1-based
  fraction: number; // of suggestedNotionalUsd
  notionalUsd: number;
}

/** Machine-checkable invalidation conditions attached to every proposal. */
export interface InvalidationSpec {
  gapClosesBelowPct: number;
  fundingFlipsAgainst: boolean;
  maxStaleMs: number;
  spreadAboveBps: number;
  depthBelowScore: number;
  expiresTs: number;
}

export interface BasisProposal extends EngineProposal {
  direction: BasisDirection;
  stagedSizes: StagedSize[];
  invalidationSpec: InvalidationSpec;
  priority: PriorityScore;
  costBreakdown: CostBreakdown;
}

// ---------- replay runner ----------

export type ReplayEvent =
  | { type: 'spotBook'; tick: BookTicker }
  | { type: 'perpBook'; tick: BookTicker }
  | { type: 'markFunding'; tick: MarkFunding }
  | { type: 'spotDepth'; ladder: DepthLadder }
  | { type: 'perpDepth'; ladder: DepthLadder }
  | { type: 'borrow'; info: BorrowInfo }
  | { type: 'fundingHistory'; symbol: string; points: FundingHistoryPoint[] }
  | { type: 'universe'; symbols: SymbolMeta[] }
  | { type: 'killSwitch'; on: boolean };

export interface ReplayStep {
  /** advance the ManualClock to this absolute ms before applying events */
  atMs: number;
  events: ReplayEvent[];
  /** run an engine tick after applying the events (default true) */
  tick?: boolean;
}

export interface ReplayResult {
  steps: number;
  ticks: number;
  decisions: Decision[];
  finalTs: number;
}

// ---------- rejection helper ----------

export interface RejectDetail {
  code: RejectCode;
  human: string;
  evidence: Record<string, number | string | boolean | null>;
}
