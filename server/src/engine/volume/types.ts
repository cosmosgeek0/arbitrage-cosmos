/**
 * Volume/wakeup engine — LOCAL types.
 * Frozen chassis contracts live in ../v0/types.ts (READ-ONLY import).
 * Everything volume-specific that the chassis does not model is defined here
 * and flagged for Director reconciliation in the lane report.
 */
import type {
  EngineProposal,
  FeatureSnapshot,
  WindowKey,
} from '../v0/types.js';
import type { RiskCheck, RiskVerdict } from '../../foundation/contracts/index.js';
import type { VolumeRejectCode } from './rejectVocabulary.js';

// ---------- extended reject vocabulary ----------

/**
 * Finer-grained reject detail codes invented by this lane. Every emitted
 * Decision still carries a FROZEN v0 RejectCode (closest semantic parent);
 * the precise detail code rides in `evidence.detailCode` so the ledger keeps
 * full fidelity without breaking the frozen contract.
 * Flagged for Director: consider promoting these into v0 RejectCode.
 */
export type VolumeDetailCode =
  | 'wash_uniformity_suspect' // uniform-size ping-pong tape, no real conviction
  | 'imbalance_weak' // taker flow present but not directional enough
  | 'depth_vanished' // top-of-book depth collapsed vs its own rolling norm
  | 'confirmation_pending' // 1s trigger fired, 5s/15s continuation not yet seen
  | 'aggregate_single_print'; // one aggTrade aggregating a single raw print

/** Map a detail code to the closest frozen v0 code (contract-safe). */
export const DETAIL_TO_V0 = {
  wash_uniformity_suspect: 'taker_imbalance_missing',
  imbalance_weak: 'taker_imbalance_missing',
  depth_vanished: 'depth_too_thin',
  confirmation_pending: null,
  aggregate_single_print: 'one_print_spike',
} as const satisfies Record<VolumeDetailCode, VolumeRejectCode | null>;

// ---------- tape / raw trade forensics ----------

/** Raw recent-trade record (bounded window, focus/candidate tier). */
export interface RawTrade {
  price: number;
  qty: number; // base
  quoteQty: number;
  isBuyerMaker: boolean; // true ⇒ taker sold
  ts: number;
  /** number of raw prints aggregated into this tick (aggTrade l-f+1); 1 if unknown */
  printCount: number;
}

export interface BurstStats {
  /** largest cluster of trades separated by < clusterGapMs */
  maxClusterTrades: number;
  maxClusterQuote: number;
  maxClusterSpanMs: number;
  clusterCount: number;
}

export interface TapeAnalysis {
  windowMs: number;
  trades: number;
  quoteVolume: number;
  /** share of window quote volume contributed by the single largest trade */
  maxTradeDominance: number; // 0..1
  /** raw prints behind the largest trade (1 = literal one print) */
  maxTradePrintCount: number;
  takerBuyRatio: number | null; // null when trades < minTradesForImbalance
  burst: BurstStats;
  /** 0..1 — high = suspiciously uniform sizes + ping-pong sides + flat price */
  washScore: number;
  washReady: boolean; // enough trades for washScore to mean anything
  priceRangePct: number;
}

// ---------- depth / book quality ----------

export interface BookQuality {
  spreadBps: number | null;
  topDepthUsd: number | null; // (bid*bidQty + ask*askQty)/2
  /** 0..1 composite of spread tightness and top-of-book depth */
  depthScore: number | null;
  /** current topDepthUsd / rolling median topDepthUsd; <1 = thinning */
  depthVsNorm: number | null;
  stalenessMs: number | null;
}

// ---------- baseline ----------

export interface BaselineStats {
  ready: boolean;
  samples: number; // completed 1-minute buckets observed
  confidence: number; // 0..1
  /** robust per-second quote volume norm (median of per-minute / 60, floored) */
  quotePerSecNorm: number;
  tradesPerSecNorm: number;
  quotePerMinMedian: number;
  quotePerMinMad: number;
  isDead: boolean; // symbol quiet vs config.deadMaxQuotePerMin
}

// ---------- extended feature snapshot ----------

/**
 * Superset of the frozen FeatureSnapshot: structurally assignable wherever a
 * FeatureSnapshot is expected (Scanner contract preserved), with the wakeup
 * signals this lane computes on top.
 */
export interface WakeupSnapshot extends FeatureSnapshot {
  baseline: BaselineStats;
  tape: TapeAnalysis | null; // null until any raw trades seen
  book: BookQuality;
  /** signed pct/min: recent 15s price rate minus prior 45s price rate */
  accelerationPctPerMin: number | null;
  realizedVolPct: Partial<Record<WindowKey, number | null>>;
  /** ms this symbol has been in FOCUS for the current session (0 outside focus) */
  focusAgeMs: number;
  /** ms since the activating 1s trigger first fired (Infinity if never) */
  signalAgeMs: number;
}

// ---------- priority ----------

export interface PriorityBreakdown {
  score: number;
  freshness: number;
  volumeMultiple: number;
  tradeCountMultiple: number;
  acceleration: number;
  spreadQuality: number;
  depthQuality: number;
  focusAgePenalty: number;
}

/** Exact immutable identity of one Volume-owned proposal cut. */
export interface VolumeProposalRiskCut {
  readonly proposalId: string;
  readonly proposalRevision: number;
  readonly proposalDigest: string;
  readonly configurationRevision: string;
  readonly correlationId: string;
  readonly symbol: string;
  readonly direction: 'long' | 'short';
  readonly updatedTs: number;
  readonly featureObservedAtMs: number;
  readonly expiresAtMs: number;
}

/**
 * Input accepted by the Volume owner's compare-and-record boundary.
 * System Integration owns canonical proposal projection and supplies the
 * untouched Foundation verdict. Volume only verifies the exact source cut
 * is still current before attaching that projection.
 */
export interface VolumeFoundationRiskAttachmentInput {
  readonly expectedProposalId: string;
  readonly expectedProposalRevision: number;
  readonly expectedProposalDigest: string;
  readonly expectedConfigurationRevision: string;
  readonly expectedCorrelationId: string;
  readonly canonicalProposalId: string;
  readonly planId: string;
  readonly riskIntentDigest: string;
  readonly verdict: Readonly<RiskVerdict>;
  readonly verdictDigest: string;
}

/** Foundation-owned result attached to one exact Volume proposal revision. */
export interface VolumeFoundationRiskResult {
  readonly owner: 'FOUNDATION_MULTI_LEG_RISK';
  readonly proposalId: string;
  readonly canonicalProposalId: string;
  readonly proposalRevision: number;
  readonly proposalDigest: string;
  readonly configurationRevision: string;
  readonly correlationId: string;
  readonly planId: string;
  readonly riskIntentDigest: string;
  readonly verdictDigest: string;
  readonly allowed: boolean;
  readonly evaluatedAt: number;
  readonly expiresAt: number;
  readonly checks: readonly Readonly<RiskCheck>[];
  readonly blockingCodes: readonly string[];
}

/** Volume-owned proposal fields copied from one decisive feature cut. */
export interface VolumeProposal extends EngineProposal {
  /** Volume proposals are directional spot wakeups, never basis leg pairs. */
  direction: 'long' | 'short';
  /** Monotonic source-owner revision, beginning at 1. */
  proposalRevision: number;
  /** Canonical digest of proposal semantics, excluding the risk attachment. */
  proposalDigest: string;
  /** Canonical revision of the exact VolumeConfig used for this cut. */
  configurationRevision: string;
  /** Exact feature-cut time shared by all three metrics below. */
  featureObservedAtMs: number;
  /** Machine-readable proposal expiry owned by Volume. */
  expiresAtMs: number;
  /** Robust completed-minute quote-volume median, in quote asset per minute. */
  baselineVolume: number | null;
  /** Current rolling 60-second quote volume, in quote asset units. */
  currentVolume1m: number | null;
  /** Detector's decisive rolling 5-second trade-count multiple. */
  tradeCountMultiple: number | null;
  /** Exact canonical Foundation result; null until compare-and-record succeeds. */
  riskResult: Readonly<VolumeFoundationRiskResult> | null;
}

// ---------- proposal invalidation ----------

export type InvalidationReason =
  | 'volume_normalized'
  | 'spread_blown_out'
  | 'move_exhausted'
  | 'ttl_expired'
  | 'universe_removed'
  | 'capacity_pruned'
  | 'signal_superseded';

export interface InvalidationRule {
  /** 60s volume multiple at/below this ⇒ volume_normalized */
  volumeNormalizedBelowMultiple: number;
  /** spot spread at/above this ⇒ spread_blown_out */
  spreadBlownOutBps: number;
  /** |move since proposal| at/above this ⇒ move_exhausted */
  moveExhaustedPct: number;
  referencePrice: number | null;
}

// ---------- synthetic replay scripting ----------

export interface ScenarioTrade {
  atMs: number; // scenario-relative time
  price: number;
  qty: number;
  isBuyerMaker?: boolean;
  printCount?: number;
}

export interface ScenarioBook {
  atMs: number;
  bid: number;
  ask: number;
  bidQty?: number;
  askQty?: number;
}

export interface ScenarioSymbolScript {
  symbol: string;
  trades: ScenarioTrade[];
  books: ScenarioBook[];
  pinned?: boolean;
  openPosition?: boolean;
}

export interface Scenario {
  name: string;
  durationMs: number;
  symbols: ScenarioSymbolScript[];
}
